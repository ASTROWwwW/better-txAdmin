-- Prevent running in monitor mode
if not TX_SERVER_MODE then return end
-- Prevent running if menu is disabled
if not TX_MENU_ENABLED then return end

local IS_PTFX_ENABLED = GetConvarBool('txAdmin-playerModePtfx', true)
local MAX_PTFX_TARGETS = 128

RegisterNetEvent('txsv:req:changePlayerMode', function(mode, nearbyPlayers)
  local src = source
  if mode ~= 'godmode' and mode ~= 'noclip' and mode ~= 'superjump' and mode ~= 'none' then
    debugPrint("Invalid player mode requested by " .. tostring(GetPlayerName(src)) .. " (mode: " .. tostring(mode))
    return
  end

  local allow = PlayerHasTxPermission(src, 'players.playermode')
  TriggerEvent('txsv:logger:menuEvent', src, "playerModeChanged", allow, mode)
  if allow then
    TriggerClientEvent('txcl:setPlayerMode', src, mode, IS_PTFX_ENABLED)

    if IS_PTFX_ENABLED and type(nearbyPlayers) == 'table' then
      local notified = {}
      for i = 1, math.min(#nearbyPlayers, MAX_PTFX_TARGETS) do
        local v = nearbyPlayers[i]
        if IsValidPlayerId(v) and not notified[v] then
          notified[v] = true
          TriggerClientEvent('txcl:showPtfx', v, src)
        end
      end
    end
  end
end)
