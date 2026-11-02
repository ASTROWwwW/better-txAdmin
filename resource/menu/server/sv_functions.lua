-- Prevent running in monitor mode
if not TX_SERVER_MODE then return end
-- Prevent running if menu is disabled
if not TX_MENU_ENABLED then return end

--- Determine if a source has a given permission
---@param source number
---@param reqPerm string
---@return boolean
function PlayerHasTxPermission(source, reqPerm)
  local allow = false
  local admin = TX_ADMINS[tostring(source)]
  if admin and admin.perms then
    for _, perm in pairs(admin.perms) do
      if perm == 'all_permissions' or reqPerm == perm then
        allow = true
        break
      end
    end
  end
  debugPrint(string.format("permission check (src=^3%d^0, perm=^4%s^0, result=%s^0)",
      source, reqPerm, (allow and '^2true' or '^1false')))
  return allow
end

--- Determine if an id sent by a client is the server id of a connected player (-1 is not one)
---@param id any
---@return boolean
function IsValidPlayerId(id)
  return type(id) == 'number' and id > 0 and id % 1 == 0 and type(GetPlayerName(id)) == 'string'
end
