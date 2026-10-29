-- =============================================
--  Smooth live view of this player's screen
--
--  The server (sv_stream.lua) gives this game a secret token when an admin opens the live view. The menu page
--  (nui) then sends small jpeg frames of the game screen to the server of this resource, until the server or the
--  token says stop. The address is made here from this game's own server endpoint: only the token is accepted.
-- =============================================

local min = math.min
local max = math.max
local tonumber = tonumber
local type = type

local function clamp(value, low, high, default)
    value = tonumber(value)
    if value == nil or value ~= value then return default end
    return max(low, min(high, value))
end

RegisterNetEvent('txcl:screenStreamStart', function(cfg)
    if type(cfg) ~= 'table' then return end
    local token = cfg.token
    if type(token) ~= 'string' or #token < 16 or #token > 64 or token:find('[^%w_%-]') then return end
    local endpoint = GetCurrentServerEndpoint()
    if type(endpoint) ~= 'string' or endpoint == '' then return end

    sendMenuMessage('screenStreamStart', {
        url = ('http://%s/%s/stream/%s'):format(endpoint, GetCurrentResourceName(), token),
        fps = clamp(cfg.fps, 5, 20, 12),
        width = clamp(cfg.width, 320, 1280, 640),
        quality = clamp(cfg.quality, 0.2, 0.8, 0.5),
        ttlMs = clamp(cfg.ttlMs, 1000, 11 * 60 * 1000, 11 * 60 * 1000),
    })
end)

RegisterNetEvent('txcl:screenStreamStop', function()
    sendMenuMessage('screenStreamStop', {})
end)
