-- Prevent running in monitor mode
if not TX_SERVER_MODE then return end


-- =============================================
--  Screenshots for the web panel ("View screen" in the player modal)
--
--  txAdmin asks (txAdmin:events:screenshotRequested), the `screenshot-basic` resource takes the
--  screenshot on the player's game, and the result goes back to txAdmin through the intercom route.
--  `screenshot-basic` is not part of txAdmin, it has to be installed and started on the server.
--  NOTE: the image is made by the player's game client, txAdmin only relays it and checks its format.
-- =============================================

local screenshotUrl = "http://" .. TX_LUACOMHOST .. "/intercom/screenshot"
local maxImageChars = 600000 -- the web server refuses bodies above 768kb
local minQuality = 0.1
local maxQuality = 0.9
local defaultQuality = 0.4
local min = math.min
local max = math.max
local tonumber = tonumber
local type = type


local function replyScreenshot(reqId, errorCode, image)
    PerformHttpRequest(screenshotUrl, function() end, 'POST', json.encode({
        txAdminToken = TX_LUACOMTOKEN,
        reqId = reqId,
        error = errorCode,
        image = image,
    }), { ['Content-Type'] = 'application/json' })
end


TX_EVENT_HANDLERS.screenshotRequested = function(eventData)
    local reqId = eventData.reqId
    local netid = tonumber(eventData.netid)
    if type(reqId) ~= 'string' or #reqId > 64 or netid == nil then return end
    local quality = max(minQuality, min(maxQuality, tonumber(eventData.quality) or defaultQuality))

    if GetResourceState('screenshot-basic') ~= 'started' then
        return replyScreenshot(reqId, 'screenshot_basic_missing')
    end
    if type(GetPlayerName(netid)) ~= 'string' then
        return replyScreenshot(reqId, 'player_gone')
    end

    local requested = pcall(function()
        exports['screenshot-basic']:requestClientScreenshot(netid, { encoding = 'jpg', quality = quality }, function(err, data)
            if err or type(data) ~= 'string' or #data > maxImageChars then
                return replyScreenshot(reqId, 'capture_failed')
            end
            replyScreenshot(reqId, nil, data)
        end)
    end)
    if not requested then
        replyScreenshot(reqId, 'capture_failed')
    end
end
