"""
Runs the Lua resource files of txAdmin in an embedded Lua (lupa) with stubs of the FXServer natives.
It checks behavior that does not need a real FXServer, and for the older security fixes it also runs the
file as it was at the fork base (8a9a414) to prove the check fails there (a negative control).

    pip install lupa
    python3 scripts/lua-tests/luatest.py

NOTE: this is not CfxLua, only Lua 5.x with stubs. It does not replace testing in a real FXServer.
Use scripts/lua-tests/cfxlint.md for the grammar check.
"""
import sys, subprocess
from pathlib import Path
try:
    from lupa import LuaRuntime
except ImportError:
    sys.exit('lupa is missing, install it with: pip install lupa')

REPO = str(Path(__file__).resolve().parents[2])
BASE = '8a9a414'  # fork base, before any of the fixes

def current(path):
    return open(f'{REPO}/{path}', encoding='utf8').read()

def old(path):
    return subprocess.check_output(['git', '-C', REPO, 'show', f'{BASE}:{path}'], text=True)

PRELUDE = r'''
TX_SERVER_MODE = true
TX_MENU_ENABLED = true
IS_FIVEM = true
IS_REDM = false
TX_LUACOMHOST = '127.0.0.1:40120'
TX_LUACOMTOKEN = 'secrettoken'
TX_ADMINS = { ['5'] = { username = 'admin', perms = { 'all_permissions' } } }
HANDLERS, LOCAL_HANDLERS, THREADS, CAPTURED, EVENTS, TRACES, MENU_EVENTS = {}, {}, {}, {}, {}, {}, {}
function RegisterNetEvent(name, fn) HANDLERS[name] = fn end
function AddEventHandler(name, fn) LOCAL_HANDLERS[name] = fn end
function CreateThread(fn) THREADS[#THREADS + 1] = fn end
function Wait() coroutine.yield() end
function PerformHttpRequest(url, cb, method, body, headers, opts)
  CAPTURED[#CAPTURED + 1] = { url = url, method = method, headers = headers, body = body }
end
function GetConvarBool(n, d) return d end
function GetConvar(n, d) return d end
function GetGameTimer() return 0 end
function GetPlayerIdentifiers(src) return { 'license:abc', 'ip:1.2.3.4' } end
function GetPlayerName(id) return 'player' .. tostring(id) end
function txPrint() end
function debugPrint() end
function TriggerClientEvent(...) EVENTS[#EVENTS + 1] = table.pack(...) end
function TriggerLatentClientEvent(...) EVENTS[#EVENTS + 1] = table.pack(...) end
function TriggerEvent(name, ...)
  if name == 'txsv:logger:menuEvent' then MENU_EVENTS[#MENU_EVENTS + 1] = table.pack(...) end
end
function PrintStructuredTrace(payload) TRACES[#TRACES + 1] = payload end
function PlayerHasTxPermission(src, perm) return src == 5 end
function GetPlayerPed(id) if id == 5 or id == 6 then return 100 + id end return 0 end
function GetEntityCoords(e) return { 10.0, 20.0, 30.0 } end
function GetPlayerRoutingBucket() return 0 end
function SetPlayerRoutingBucket() end
function GetNumResources() return 0 end
function GetResourceByFindIndex() return nil end
function GetResourceState() return 'stopped' end
function GetResourceMetadata() return nil end
local function enc(v)
  local t = type(v)
  if t == 'string' then return '"' .. v:gsub('["\\]', '\\%0') .. '"' end
  if t == 'number' or t == 'boolean' then return tostring(v) end
  if t == 'table' then
    local parts = {}
    if #v > 0 then for _, x in ipairs(v) do parts[#parts + 1] = enc(x) end return '[' .. table.concat(parts, ',') .. ']' end
    for k, x in pairs(v) do parts[#parts + 1] = '"' .. tostring(k) .. '":' .. enc(x) end
    return '{' .. table.concat(parts, ',') .. '}'
  end
  return 'null'
end
json = { encode = enc }
function call_event(name, src, ...) source = src; return HANDLERS[name](...) end
function run_threads_once()
  -- drives the flush loop: first resume reaches Wait, second runs one flush
  local co = coroutine.create(THREADS[1])
  coroutine.resume(co); coroutine.resume(co)
end
'''

def env(*sources):
    lua = LuaRuntime(unpack_returned_tuples=True, register_eval=False)
    lua.execute(PRELUDE)
    for name, text in sources:
        lua.execute(text) if False else lua.eval('load')(text, name)()
    return lua

PASS, FAIL = 0, 0
def check(label, cond, detail=''):
    global PASS, FAIL
    if cond: PASS += 1
    else: FAIL += 1
    print(('  ok   ' if cond else '  FAIL ') + label + ((' -> ' + str(detail)) if detail and not cond else ''))

def lua_keys(tbl):
    return sorted([str(k) for k in tbl.keys()])

# ---------------------------------------------------------------- webpipe
def webpipe(label, text):
    print(f'[sv_webpipe.lua | {label}]')
    lua = env(('webpipe', text))
    hdrs = lua.eval('''{
      ['x-txadmin-identifiers'] = 'fivem:999', ['X-TXADMIN-TOKEN'] = 'evil', ['X-Forwarded-For'] = '1.1.1.1',
      ['x-forwarded-proto'] = 'https', ['Accept'] = 'text/html', [1] = 'junk' }''')
    lua.eval('call_event')('txsv:webpipe:req', 5, 1, 'GET', '/api/test', hdrs, '')
    cap = lua.eval('CAPTURED')
    sent = cap[1]['headers'] if cap[1] else None
    keys = lua_keys(sent) if sent else []
    return lua, sent, keys

lua, sent, keys = webpipe('current', current('resource/menu/server/sv_webpipe.lua'))
check('request is forwarded for an authed admin', sent is not None)
check('client x-txadmin-* headers are dropped (any casing)', not any(k.lower().startswith('x-txadmin-') and k not in ('X-TxAdmin-Token', 'X-TxAdmin-Identifiers') for k in keys), keys)
check('server token is the only token header', sent['X-TxAdmin-Token'] == 'secrettoken')
check('server identifiers are the only identifiers header', sent['X-TxAdmin-Identifiers'] == 'license:abc,ip:1.2.3.4', sent['X-TxAdmin-Identifiers'])
check('client x-forwarded-* headers are dropped', not any(k.lower().startswith('x-forwarded-') for k in keys), keys)
check('non-string header keys are dropped', '1' not in keys, keys)
check('legit headers are kept', sent['Accept'] == 'text/html')

lua, sent, keys = webpipe('base, before the fix (negative control)', old('resource/menu/server/sv_webpipe.lua'))
spoofed = [k for k in keys if k.lower() == 'x-txadmin-identifiers' and k != 'X-TxAdmin-Identifiers']
check('base lets the forged identifiers header through (the bug is real)', len(spoofed) == 1, keys)

# unauthed player
print('[sv_webpipe.lua | unauthed player]')
lua = env(('webpipe', current('resource/menu/server/sv_webpipe.lua')))
lua.eval('call_event')('txsv:webpipe:req', 9, 1, 'GET', '/x', lua.eval('{}'), '')
check('no request leaves for a player who is not an admin', len(lua.eval('CAPTURED')) == 0)
check('the player gets a 403', lua.eval('EVENTS')[1][4] == 403)

# ---------------------------------------------------------------- logger
def logger(label, text):
    print(f'[sv_logger.lua | {label}]')
    lua = env(('logger', text))
    c = lua.eval('call_event')
    c('txsv:logger:deathEvent', 7, False, 'Pistol')
    c('txsv:logger:deathEvent', 7, lua.eval('{1,2}'), 'Pistol')
    c('txsv:logger:deathEvent', 7, 3, 'x' * 1000)
    c('txaLogger:DebugMessage', 7, lua.eval('{"a"}'))
    c('txaLogger:DebugMessage', 7, 'y' * 600)
    c('txaLogger:CommandExecuted', 7, 'say hi')
    lua.eval('run_threads_once')()
    return lua

def payload_entries(lua):
    traces = lua.eval('TRACES')
    import json
    out = []
    for i in range(1, len(traces) + 1):
        out.extend(json.loads(traces[i])['logs'])
    return out

lua = logger('current', current('resource/sv_logger.lua'))
entries = payload_entries(lua)
deaths = [e for e in entries if e['type'] == 'DeathNotice']
debug = [e for e in entries if e['type'] == 'DebugMessage']
cmds = [e for e in entries if e['type'] == 'CommandExecuted']
check('valid death notice is logged', any(e['data'].get('cause') == 'Pistol' for e in deaths))
check('death notice with a table killer is dropped', len(deaths) == 2, len(deaths))
check('long death cause is truncated to 256', any(len(e['data']['cause']) == 256 for e in deaths))
check('non-string debug message is dropped', not any(isinstance(e['data'], dict) for e in debug))
check('long debug message is truncated to 256', len(debug) == 1 and len(debug[0]['data']) == 256, [len(e['data']) for e in debug])
check('command string is kept', len(cmds) == 1 and cmds[0]['data'] == 'say hi')

lua = env(('logger', current('resource/sv_logger.lua')))
for i in range(2500): lua.eval('call_event')('txaLogger:CommandExecuted', 7, 'cmd')
lua.eval('run_threads_once')()
flood = [e for e in payload_entries(lua) if e['type'] == 'CommandExecuted']
check('a flood from one client is capped at 2000 entries per flush', len(flood) == 2000, len(flood))

lua = logger('base, before the fix (negative control)', old('resource/sv_logger.lua'))
entries = payload_entries(lua)
check('base accepts a table killer and 1000-char causes (the gap is real)', len([e for e in entries if e['type'] == 'DeathNotice']) == 3 and any(len(e['data']['cause']) == 1000 for e in entries if e['type'] == 'DeathNotice'))
lua = env(('logger', old('resource/sv_logger.lua')))
for i in range(2500): lua.eval('call_event')('txaLogger:CommandExecuted', 7, 'cmd')
lua.eval('run_threads_once')()
check('base has no cap (2500 entries)', len([e for e in payload_entries(lua) if e['type'] == 'CommandExecuted']) == 2500)

# ---------------------------------------------------------------- menu handlers
def menu(label, main_text, modal_text):
    print(f'[menu handlers | {label}]')
    lua = env(('main', main_text), ('modal', modal_text))
    c = lua.eval('call_event')
    c('txsv:req:healEveryone', 7)   # not an admin
    c('txsv:req:healEveryone', 5)   # admin
    me = lua.eval('MENU_EVENTS')
    heal_flags = [me[i][3] for i in range(1, len(me) + 1) if me[i][2] == 'healAll']
    lua.eval('EVENTS')  # keep
    lua.execute('EVENTS = {}')
    c('txsv:req:bringPlayer', 5, 99)  # nobody at 99
    bring_events = [lua.eval('EVENTS')[i] for i in range(1, len(lua.eval('EVENTS')) + 1) if lua.eval('EVENTS')[i][1] == 'txcl:tpToCoords']
    lua.execute('EVENTS = {}')
    c('txsv:req:tpToPlayer', 5, 99)
    tp_events = [lua.eval('EVENTS')[i] for i in range(1, len(lua.eval('EVENTS')) + 1) if lua.eval('EVENTS')[i][1] == 'txcl:tpToCoords']
    lua.execute('EVENTS = {}')
    c('txsv:req:bringPlayer', 5, 6)   # online player
    ok_bring = [lua.eval('EVENTS')[i] for i in range(1, len(lua.eval('EVENTS')) + 1) if lua.eval('EVENTS')[i][1] == 'txcl:tpToCoords']
    return heal_flags, bring_events, tp_events, ok_bring

heal, bring, tp, ok_bring = menu('current', current('resource/menu/server/sv_main_page.lua'), current('resource/menu/server/sv_player_modal.lua'))
check('heal-all by a non-admin is logged as denied (false), by an admin as allowed (true)', heal == [False, True], heal)
check('bring a missing player does nothing', len(bring) == 0, len(bring))
check('teleport to a missing player does nothing (no jump to the map origin)', len(tp) == 0, len(tp))
check('bring an online player still works', len(ok_bring) == 1, len(ok_bring))

heal, bring, tp, ok_bring = menu('base, before the fix (negative control)', old('resource/menu/server/sv_main_page.lua'), old('resource/menu/server/sv_player_modal.lua'))
check('base logs heal-all as allowed even for a non-admin (the bug is real)', heal == [True, True], heal)
check('base sends the admin to a missing player coordinates', len(tp) == 1, len(tp))

# ---------------------------------------------------------------- player positions (live map)
def positions_env(onesync='on', players=None):
    lua = LuaRuntime(unpack_returned_tuples=True, register_eval=False)
    lua.execute(PRELUDE)
    lua.execute("""
    TX_EVENT_HANDLERS = {}
    TX_PLAYERLIST = {}
    GAME_TIMER = 0
    function GetGameTimer() return GAME_TIMER end
    function GetConvar(n, d) if n == 'onesync' then return '%s' end return d end
    PLAYERS = { ['3'] = { x = 100.4, y = -200.6, veh = nil }, ['4'] = { x = -3000.2, y = 7000.9, veh = 'automobile' },
                ['5'] = { x = 1.0, y = 2.0, veh = 'mystery' }, ['6'] = nil, ['7'] = { x = 0.5, y = 0.5, noped = true } }
    function GetPlayers() local out = {} for id, p in pairs(PLAYERS) do out[#out + 1] = id end table.sort(out) return out end
    function GetPlayerPed(id) local p = PLAYERS[tostring(id)] if p and not p.noped then return tonumber(id) + 1000 end return 0 end
    function DoesEntityExist(e) return e ~= nil and e ~= 0 end
    function GetPedHealthPercent(ped) return 80 end
    function GetVehiclePedIsIn(ped) local p = PLAYERS[tostring(ped - 1000)] if p and p.veh then return ped + 5000 end return 0 end
    function GetVehicleType(veh) return PLAYERS[tostring(veh - 6000)].veh end
    function GetEntityCoords(ped) local p = PLAYERS[tostring(ped - 1000)] return { x = p.x, y = p.y, z = 30.0 } end
    """ % onesync)
    lua.eval('load')(current('resource/sv_playerlist.lua'), 'playerlist')()
    lua.execute("""
    CYCLE = coroutine.create(THREADS[1])
    function run_cycle() TRACES = {} coroutine.resume(CYCLE) end
    """)
    return lua

def position_traces(lua):
    import json as pyjson
    t = lua.eval('TRACES')
    out = []
    for i in range(1, len(t) + 1):
        d = pyjson.loads(t[i])
        if d.get('type') == 'txAdminPlayerPositions': out.append(d)
    return out

print('[sv_playerlist.lua | live map positions]')
lua = positions_env('on')
lua.eval('run_cycle')()
check('nothing is reported until the core asks for positions', position_traces(lua) == [])
check('the core can ask with the txaEvent whitelist handler', lua.eval('type(TX_EVENT_HANDLERS.playerPositionsWanted)') == 'function')
lua.eval('TX_EVENT_HANDLERS.playerPositionsWanted')(lua.eval('{ ttlMs = 20000 }'))
lua.execute('GAME_TIMER = 1500')
lua.eval('run_cycle')()
tr = position_traces(lua)
check('a report is sent while asked', len(tr) == 1, len(tr))
players = {p[0]: p for p in tr[0]['players']} if tr else {}
check('the report has netid, floored x, floored y and the vehicle type', players.get(3) == [3, 100, -201, 0] and players.get(4) == [4, -3001, 7000, 1], players)
check('players without a ped are left out', 7 not in players, list(players))
check('an unknown vehicle type is sent as -1, never as null', players.get(5, [0,0,0,None])[3] == -1, players.get(5))
lua.execute('GAME_TIMER = 21600')
lua.eval('run_cycle')()
check('reports stop once the time to live is over', position_traces(lua) == [])
lua.eval('TX_EVENT_HANDLERS.playerPositionsWanted')(lua.eval('{ ttlMs = 99999999 }'))
lua.execute('GAME_TIMER = 21600 + 60001')
lua.eval('run_cycle')()
check('a huge time to live is capped at 60 seconds', position_traces(lua) == [])
for bad in ["nil", "'abc'", "-5", "{}"]:
    lua = positions_env('on')
    lua.execute('GAME_TIMER = 100')
    lua.eval('TX_EVENT_HANDLERS.playerPositionsWanted')(lua.eval('{ ttlMs = %s }' % bad))
    lua.eval('run_cycle')()
    check(f'an invalid time to live ({bad}) does not turn reporting on', position_traces(lua) == [])
for mode in ['off']:
    lua = positions_env(mode)
    lua.eval('TX_EVENT_HANDLERS.playerPositionsWanted')(lua.eval('{ ttlMs = 20000 }'))
    lua.eval('run_cycle')()
    check(f'nothing is reported without onesync ({mode})', position_traces(lua) == [])

# ---------------------------------------------------------------- screenshots (view a player's screen from the panel)
import json as pyjson

def shot_env(started=True, players=('12',), export='ok', quality_log=None):
    lua = LuaRuntime(unpack_returned_tuples=True, register_eval=False)
    lua.execute(PRELUDE)
    lua.execute("""
    TX_EVENT_HANDLERS = {}
    STARTED = %s
    EXPORT_MODE = '%s'
    LAST_OPTS = nil
    PLAYER_NAMES = {}
    function GetResourceState(name) if name == 'screenshot-basic' and STARTED then return 'started' end return 'missing' end
    function GetPlayerName(id) return PLAYER_NAMES[tostring(id)] end
    exports = setmetatable({}, { __index = function(_, name)
      if name ~= 'screenshot-basic' then return nil end
      return setmetatable({}, { __index = function(_, fn)
        if fn ~= 'requestClientScreenshot' then return nil end
        return function(_self, netid, opts, cb)
          LAST_OPTS = opts
          if EXPORT_MODE == 'throws' then error('boom') end
          if EXPORT_MODE == 'error' then return cb('some client error', nil) end
          if EXPORT_MODE == 'huge' then return cb(false, 'data:image/jpeg;base64,' .. string.rep('A', 600001)) end
          if EXPORT_MODE == 'nodata' then return cb(false, nil) end
          return cb(false, 'data:image/jpeg;base64,/9j/AAAA')
        end
      end })
    end })
    """ % ('true' if started else 'false', export))
    for pid in players:
        lua.execute(f"PLAYER_NAMES['{pid}'] = 'player{pid}'")
    lua.eval('load')(current('resource/sv_screenshot.lua'), 'screenshot')()
    return lua

def posts(lua):
    cap = lua.eval('CAPTURED')
    out = []
    for i in range(1, len(cap) + 1):
        out.append((cap[i]['url'], cap[i]['method'], pyjson.loads(cap[i]['body'])))
    return out

def ask(lua, **fields):
    data = {'reqId': 'req1234567890', 'netid': 12, 'quality': 0.4}
    data.update(fields)
    tbl = lua.eval('{}')
    for k, v in data.items(): tbl[k] = v
    lua.eval('TX_EVENT_HANDLERS.screenshotRequested')(tbl)

print('[sv_screenshot.lua | screenshots for the panel]')
lua = shot_env()
check('the core can ask through the txaEvent whitelist handler', lua.eval('type(TX_EVENT_HANDLERS.screenshotRequested)') == 'function')
ask(lua)
p = posts(lua)
check('the frame is posted to the intercom with the token and the request id', len(p) == 1 and p[0][0] == 'http://127.0.0.1:40120/intercom/screenshot' and p[0][1] == 'POST' and p[0][2].get('txAdminToken') == 'secrettoken' and p[0][2].get('reqId') == 'req1234567890', p)
check('the image is sent as is, without an error', p[0][2].get('image') == 'data:image/jpeg;base64,/9j/AAAA' and 'error' not in p[0][2], p[0][2])
check('the capture is asked as a jpeg with the quality of the core', lua.eval('LAST_OPTS.encoding') == 'jpg' and abs(lua.eval('LAST_OPTS.quality') - 0.4) < 1e-9)

lua = shot_env(started=False)
ask(lua)
p = posts(lua)
check('without screenshot-basic the core is told so', len(p) == 1 and p[0][2].get('error') == 'screenshot_basic_missing', p)

lua = shot_env(players=())
ask(lua)
p = posts(lua)
check('a player who left is reported as gone, nothing is captured', len(p) == 1 and p[0][2].get('error') == 'player_gone' and lua.eval('LAST_OPTS') is None, p)

for mode in ['error', 'throws', 'huge', 'nodata']:
    lua = shot_env(export=mode)
    ask(lua)
    p = posts(lua)
    check(f'a capture that fails ({mode}) is reported as capture_failed, never relayed', len(p) == 1 and p[0][2].get('error') == 'capture_failed' and 'image' not in p[0][2], p)

for label, fields in [('a request id that is not a string', {'reqId': 5}), ('a request id that is too long', {'reqId': 'x' * 65}), ('a netid that is not a number', {'netid': 'abc'})]:
    lua = shot_env()
    ask(lua, **fields)
    check(f'{label} is ignored', posts(lua) == [])

lua = shot_env()
ask(lua, quality=5)
check('the quality is capped at 0.9', abs(lua.eval('LAST_OPTS.quality') - 0.9) < 1e-9)
lua = shot_env()
ask(lua, quality=-3)
check('the quality has a floor of 0.1', abs(lua.eval('LAST_OPTS.quality') - 0.1) < 1e-9)

print(f'\n{PASS} checks passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
