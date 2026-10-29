-- Prevent running in monitor mode
if not TX_SERVER_MODE then return end


-- =============================================
--  Smooth live view of a player's screen ("Live view" in the player modal)
--
--  txAdmin asks (txAdmin:events:screenStreamStart), this file gives the player's game a secret upload token,
--  the game sends small jpeg frames to /monitor/stream/<token> and they are forwarded to txAdmin through the
--  intercom route, which shows them to the admin. No other resource is needed.
--  NOTE: the frames are made by the player's game client, txAdmin only relays them and checks their format.
--  The only things the game client can do here are to send frames (or not) for the session it was given.
-- =============================================

local streamUrl = "http://" .. TX_LUACOMHOST .. "/intercom/screenstream"
local maxFrameChars = 400000 -- base64, the web server refuses bodies above 768kb
local minGapMs = 30          -- more than ~30 frames a second is dropped
local maxStreams = 8
local maxInFlight = 2    -- frames being forwarded to txAdmin at once for a stream
local minTtlMs = 1000
local maxTtlMs = 11 * 60 * 1000
local min = math.min
local max = math.max
local floor = math.floor
local tonumber = tonumber
local type = type

local streams = {}   -- token -> { sessionId, netid, expiresAt, lastAt, inflight }
local bySession = {} -- sessionId -> token
local streamCount = 0

local corsHeaders = {
    ['Content-Type'] = 'application/json',
    ['Cache-Control'] = 'no-store',
    ['X-Content-Type-Options'] = 'nosniff',
    ['Access-Control-Allow-Origin'] = '*', -- the game page is not on this origin, and the token is the secret
    ['Access-Control-Allow-Methods'] = 'POST, OPTIONS',
    ['Access-Control-Allow-Headers'] = 'Content-Type',
    ['Access-Control-Max-Age'] = '600',
}
local OK = '{"ok":true}'
local STOP = '{"stop":true}'


local function reply(res, status, body)
    res.writeHead(status, corsHeaders)
    res.send(body or '')
end

local function clamp(value, low, high, default)
    value = tonumber(value)
    if value == nil or value ~= value then return default end
    return max(low, min(high, value))
end

local function removeStream(token, tellPlayer)
    local stream = streams[token]
    if not stream then return end
    streams[token] = nil
    bySession[stream.sessionId] = nil
    streamCount = streamCount - 1
    if tellPlayer then
        TriggerClientEvent('txcl:screenStreamStop', stream.netid)
    end
end


TX_EVENT_HANDLERS.screenStreamStart = function(eventData)
    if type(eventData) ~= 'table' then return end
    local sessionId = eventData.sessionId
    local token = eventData.token
    local netid = tonumber(eventData.netid)
    if type(sessionId) ~= 'string' or #sessionId < 1 or #sessionId > 64 then return end
    if type(token) ~= 'string' or #token < 16 or #token > 64 or token:find('[^%w_%-]') then return end
    if netid == nil or netid ~= netid or type(GetPlayerName(netid)) ~= 'string' then return end

    -- a new view of the same player replaces the old one
    for oldToken, stream in pairs(streams) do
        if stream.netid == netid or stream.sessionId == sessionId then
            removeStream(oldToken, true)
        end
    end
    if streamCount >= maxStreams then return end

    local ttlMs = floor(clamp(eventData.ttlMs, minTtlMs, maxTtlMs, maxTtlMs))
    streams[token] = {
        sessionId = sessionId,
        netid = netid,
        expiresAt = GetGameTimer() + ttlMs,
        lastAt = -minGapMs,
        inflight = 0,
    }
    bySession[sessionId] = token
    streamCount = streamCount + 1

    -- The url is built by the game from its own server endpoint, only the token is given
    TriggerClientEvent('txcl:screenStreamStart', netid, {
        token = token,
        fps = floor(clamp(eventData.fps, 5, 20, 12)),
        width = floor(clamp(eventData.width, 320, 1280, 640)),
        quality = clamp(eventData.quality, 0.2, 0.8, 0.5),
        ttlMs = ttlMs,
    })
end


TX_EVENT_HANDLERS.screenStreamStop = function(eventData)
    if type(eventData) ~= 'table' or type(eventData.sessionId) ~= 'string' then return end
    local token = bySession[eventData.sessionId]
    if token then removeStream(token, true) end
end


--- Called by sv_main.lua for every http request under /monitor/stream/
function TX_STREAM_HTTP(req, res)
    if req.method == 'OPTIONS' then return reply(res, 204) end
    if req.method ~= 'POST' then return reply(res, 405, STOP) end

    local token = type(req.path) == 'string' and req.path:match('^/stream/([%w_%-]+)$')
    local stream = token and streams[token]
    if not stream then return reply(res, 404, STOP) end -- unknown or ended: the sender stops
    if GetGameTimer() >= stream.expiresAt then
        removeStream(token, false)
        return reply(res, 410, STOP)
    end

    local headers = req.headers or {}
    local declared = tonumber(headers['content-length'] or headers['Content-Length'])
    if declared and declared > maxFrameChars then
        return reply(res, 413, OK) -- refused before the body is read
    end

    req.setDataHandler(function(body)
        if type(body) ~= 'string' or #body == 0 or #body > maxFrameChars then
            return reply(res, 413, OK)
        end
        local now = GetGameTimer()
        if stream.inflight >= maxInFlight or now - stream.lastAt < minGapMs or streams[token] ~= stream then
            return reply(res, 200, OK) -- too fast or too many are still on their way: dropped, no queue
        end
        stream.lastAt = now
        stream.inflight = stream.inflight + 1

        -- sessionId comes from the table above and not from the request, the player only chooses the frame
        PerformHttpRequest(streamUrl, function(code, data)
            stream.inflight = stream.inflight - 1
            if code ~= 200 or type(data) ~= 'string' or data:find('"stop"%s*:%s*true') then
                removeStream(token, false)
                return reply(res, 200, STOP)
            end
            reply(res, 200, OK)
        end, 'POST', json.encode({
            txAdminToken = TX_LUACOMTOKEN,
            sessionId = stream.sessionId,
            frame = body,
        }), { ['Content-Type'] = 'application/json' })
    end)
end
