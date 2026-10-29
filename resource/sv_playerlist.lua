-- Prevent running in monitor mode
if not TX_SERVER_MODE then return end


-- =============================================
--  Server PlayerList handler
-- =============================================

local function logError(x)
    txPrint("^1" .. x)
end
local oneSyncConvar = GetConvar('onesync', 'off')
local onesyncEnabled = oneSyncConvar == 'on' or oneSyncConvar == 'legacy'


-- Optimizations
local floor = math.floor
local min = math.min
local sub = string.sub
local tonumber = tonumber
local tostring = tostring
local pairs = pairs


-- Variables & Consts
-- https://www.desmos.com/calculator/dx9f5ko2ge
local refreshMinDelay = 1500
local refreshMaxDelay = 5000
local maxPlayersDelayCeil = 300 --at this number, the delay won't increase more
local intervalYieldLimit = 50
local vTypeMap = {
    ["nil"] = -1,
    ["walking"] = 0,
    ["automobile"] = 1,
    ["bike"] = 2,
    ["boat"] = 3,
    ["heli"] = 4,
    ["plane"] = 5,
    ["submarine"] = 6,
    ["trailer"] = 7,
    ["train"] = 8,
}


--[[ Wrapper to refresh player list data ]]
local function refreshPlayerList()
    -- For each player
    local players = GetPlayers()
    for yieldCounter, serverID in pairs(players) do
        -- Updating player vehicle/health
        local health = -1
        local vType = -1
        local xCoord = nil
        local yCoord = nil
        if onesyncEnabled == true then
            local ped = GetPlayerPed(serverID)
            if ped and DoesEntityExist(ped) then
                health = GetPedHealthPercent(ped)
                local veh = GetVehiclePedIsIn(ped)
                if veh ~= 0 and DoesEntityExist(veh) then
                   vType = vTypeMap[tostring(GetVehicleType(veh))]
                else
                   vType = vTypeMap["walking"]
                end
                local coords = GetEntityCoords(ped)
                xCoord = math.floor(coords.x)
                yCoord = math.floor(coords.y)
            end
        end

        -- Updating TX_PLAYERLIST
        if type(TX_PLAYERLIST[serverID]) ~= 'table' then
            TX_PLAYERLIST[serverID] = {
                name = sub(GetPlayerName(serverID) or "unknown", 1, 75),
                health = health,
                vType = vType,
                xCoord = xCoord,
                yCoord = yCoord,
            }
        else
            TX_PLAYERLIST[serverID].health = health
            TX_PLAYERLIST[serverID].vType = vType
            TX_PLAYERLIST[serverID].xCoord = xCoord
            TX_PLAYERLIST[serverID].yCoord = yCoord
        end

        -- Mark as refreshed
        TX_PLAYERLIST[serverID].foundLastCheck = true

        -- Yield to prevent hitches
        if yieldCounter % intervalYieldLimit == 0 then
            Wait(0)
        end
    end --end for players


    --Check if player disconnected
    local playersOnline = 0
    for playerID, playerData in pairs(TX_PLAYERLIST) do
        if playerData.foundLastCheck == true then
            playersOnline = playersOnline + 1
            playerData.foundLastCheck = false
        else
            TX_PLAYERLIST[playerID] = nil
        end
    end
    return playersOnline
end


--[[ Live map of the web panel: positions are only reported while txAdmin asks for them ]]
local positionsWantedUntil = 0
local positionsMaxTtl = 60000

TX_EVENT_HANDLERS.playerPositionsWanted = function(eventData)
    local ttlMs = tonumber(eventData.ttlMs)
    if ttlMs == nil or ttlMs <= 0 then return end
    positionsWantedUntil = GetGameTimer() + min(ttlMs, positionsMaxTtl)
end

local function reportPositions()
    if not onesyncEnabled or GetGameTimer() >= positionsWantedUntil then return end
    local players = {}
    local count = 0
    for serverID, data in pairs(TX_PLAYERLIST) do
        local netid = tonumber(serverID)
        if netid ~= nil and data.xCoord ~= nil and data.yCoord ~= nil then
            count = count + 1
            players[count] = { netid, data.xCoord, data.yCoord, data.vType or -1 }
        end
    end
    PrintStructuredTrace(json.encode({
        type = 'txAdminPlayerPositions',
        players = players,
    }))
end


--[[ Thread to refresh player list ]]
CreateThread(function()
    while true do
        -- Attempt to refresh player list
        local callSuccess, callOutput = pcall(refreshPlayerList)
        local playersOnline = 0
        if callSuccess then
            playersOnline = callOutput
            if not pcall(reportPositions) then
                logError("failed to report player positions")
            end
        else
            logError("failed to update playerlist")
        end

        -- DEBUG
        -- debugPrint("====================================")
        -- print(json.encode(TX_PLAYERLIST, {indent = true}))
        -- debugPrint("====================================")

        -- Refresh interval with linear function
        local hDiff = refreshMaxDelay - refreshMinDelay
        local calcDelay = (hDiff / maxPlayersDelayCeil) * (playersOnline) + refreshMinDelay
        local delay = floor(min(calcDelay, refreshMaxDelay))
        Wait(delay)
    end --end while true
end)


--[[ Handle player Join or Leave ]]
AddEventHandler('playerJoining', function(srcString, _oldID)
    -- sanity checking source
    if source <= 0 then
        logError('playerJoining event with source ' .. json.encode(source))
        return
    end

    -- checking if the player was not already dropped
    local playerDetectedName = GetPlayerName(source)
    if type(playerDetectedName) ~= 'string' then
        logError('Received a playerJoining for a player that was already dropped. There is some resource dropping the player at the playerJoining event handler without first waiting for the next tick.')
        return
    end

    local playerData = {
        name = sub(playerDetectedName or "unknown", 1, 128),
        ids = GetPlayerIdentifiers(source),
        hwids = GetPlayerTokens(source),
    }
    PrintStructuredTrace(json.encode({
        type = 'txAdminPlayerlistEvent',
        event = 'playerJoining',
        id = source,
        player = playerData
    }))

    -- relaying this info to all admins
    for adminID, _ in pairs(TX_ADMINS) do
        TriggerClientEvent('txcl:plist:updatePlayer', adminID, source, playerData.name)
    end
end)

AddEventHandler('playerDropped', function(reason, resource, category)
    -- sanity checking source
    if source <= 0 then
        logError('playerDropped event with source ' .. json.encode(source))
        return
    end

    if resource == 'monitor' and TX_IS_SERVER_SHUTTING_DOWN then
        reason = 'server_shutting_down'
    end

    PrintStructuredTrace(json.encode({
        type = 'txAdminPlayerlistEvent',
        event = 'playerDropped',
        id = source,
        reason = reason,
        resource = resource,
        category = category,
    }))

    -- relaying this info to all admins
    for adminID, _ in pairs(TX_ADMINS) do
        TriggerClientEvent('txcl:plist:updatePlayer', adminID, source, false)
    end
end)


-- Handle getDetailedPlayerlist
-- This event is only called when the menu "players" tab is opened, and every 5s while the tab is open
-- DEBUG playerlist scroll test stuff
-- math.randomseed(os.time())
-- local fake_playerlist = {}
-- local fake_admins = {1, 10, 21, 61, 91, 141, 281}
-- local function getFakePlayer()
--     return {
--         name = 'fake'..tostring(math.random(999999)),
--         health = 0,
--         vType = math.random(8),
--     }
-- end
-- for serverID=1, 500 do
--     fake_playerlist[serverID] = getFakePlayer()
-- end
RegisterNetEvent('txsv:req:plist:getDetailed', function(getPlayerNames)
    if TX_ADMINS[tostring(source)] == nil then
        debugPrint('Ignoring unauthenticated getDetailedPlayerlist() by ' .. source)
        return
    end

    local players = {}
    --DEBUG replace TX_PLAYERLIST with fake_playerlist and playerData.health with math.random(150)
    for playerID, playerData in pairs(TX_PLAYERLIST) do
        players[#players + 1] = {
            tonumber(playerID),
            playerData.health,
            playerData.vType,
            playerData.xCoord,
            playerData.yCoord,
        }
        if getPlayerNames then
            players[#players][6] = playerData.name
        end
    end
    local admins = {}
    for adminID, _ in pairs(TX_ADMINS) do
        admins[#admins + 1] = tonumber(adminID)
    end
    --DEBUG replace admins with fake_admins
    TriggerClientEvent('txcl:plist:setDetailed', source, players, admins)
end)


-- Sends the initial playlist to a specific admin
-- Triggered by the server after admin auth
function sendInitialPlayerlist(adminID)
    local payload = {}
    --DEBUG replace TX_PLAYERLIST with fake_playerlist
    for playerID, playerData in pairs(TX_PLAYERLIST) do
        payload[#payload + 1] = { tonumber(playerID), playerData.name }
    end
    --DEBUG
    -- debugPrint("====================================")
    -- print(json.encode(payload, {indent = true}))
    -- debugPrint("====================================")

    debugPrint('Sending initial playerlist to ' .. adminID)
    TriggerClientEvent('txcl:plist:setInitial', adminID, payload)
end
