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
    lua.eval('load')(current('resource/menu/server/sv_functions.lua'), 'sv_functions')()
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

# ---------------------------------------------------------------- live stream (smooth view of a player's screen)
def stream_env(players=('12', '13')):
    lua = LuaRuntime(unpack_returned_tuples=True, register_eval=False)
    lua.execute(PRELUDE)
    lua.execute("""
    TX_EVENT_HANDLERS = {}
    NOW = 1000
    CALLBACKS = {}
    PLAYER_NAMES = {}
    function GetGameTimer() return NOW end
    function GetPlayerName(id) return PLAYER_NAMES[tostring(id)] end
    function GetCurrentResourceName() return 'monitor' end
    function PerformHttpRequest(url, cb, method, body, headers)
      CAPTURED[#CAPTURED + 1] = { url = url, method = method, headers = headers, body = body }
      CALLBACKS[#CALLBACKS + 1] = cb
    end
    function make_req(method, path, headers)
      local r = { method = method, path = path, headers = headers or {} }
      r.setDataHandler = function(fn) r.handler = fn end
      return r
    end
    function make_res()
      local r = {}
      r.writeHead = function(code, headers) r.code = code; r.headers = headers end
      r.send = function(body) r.sent = body end
      return r
    end
    """)
    for pid in players:
        lua.execute(f"PLAYER_NAMES['{pid}'] = 'player{pid}'")
    lua.eval('load')(current('resource/sv_stream.lua'), 'stream')()
    return lua

TOKEN = 'tok_abcdefghijklmnop-1234'

def stream_start(lua, **fields):
    data = {'sessionId': 'sess1', 'token': TOKEN, 'netid': 12, 'fps': 12, 'width': 640, 'quality': 0.5, 'ttlMs': 600000}
    data.update(fields)
    tbl = lua.eval('{}')
    for k, v in data.items(): tbl[k] = v
    lua.eval('TX_EVENT_HANDLERS.screenStreamStart')(tbl)

def stream_post(lua, token=TOKEN, body='/9j/AAAA', method='POST', headers=None, path=None):
    req = lua.eval('make_req')(method, path or f'/stream/{token}', lua.eval('{}') if headers is None else headers)
    res = lua.eval('make_res')()
    lua.eval('TX_STREAM_HTTP')(req, res)
    if req['handler'] is not None and body is not None:
        req['handler'](body)
    return req, res

def client_events(lua):
    ev = lua.eval('EVENTS')
    return [(ev[i][1], ev[i][2], ev[i][3]) for i in range(1, len(ev) + 1)]

print('[sv_stream.lua | smooth live view]')
lua = stream_env()
check('the core can start and stop through the txaEvent whitelist handlers', lua.eval('type(TX_EVENT_HANDLERS.screenStreamStart)') == 'function' and lua.eval('type(TX_EVENT_HANDLERS.screenStreamStop)') == 'function')
stream_start(lua)
ev = lua.eval('EVENTS')
check('the player gets the token and the capture settings, nothing else (no url)', len(ev) == 1 and ev[1][1] == 'txcl:screenStreamStart' and ev[1][2] == 12 and ev[1][3]['token'] == TOKEN and ev[1][3]['fps'] == 12 and ev[1][3]['width'] == 640 and abs(ev[1][3]['quality'] - 0.5) < 1e-9 and ev[1][3]['url'] is None, client_events(lua))

# settings are clamped again here, the core is trusted but the values go to a game client
lua = stream_env()
stream_start(lua, fps=500, width=99999, quality=9, ttlMs=99999999)
cfg = lua.eval('EVENTS')[1][3]
check('fps, width, quality and lifetime are capped', cfg['fps'] == 20 and cfg['width'] == 1280 and abs(cfg['quality'] - 0.8) < 1e-9 and cfg['ttlMs'] == 660000, dict(cfg))
lua = stream_env()
stream_start(lua, fps=0, width=1, quality=-1, ttlMs=5)
cfg = lua.eval('EVENTS')[1][3]
check('and have a floor', cfg['fps'] == 5 and cfg['width'] == 320 and abs(cfg['quality'] - 0.2) < 1e-9 and cfg['ttlMs'] == 1000, dict(cfg))

for label, fields in [
    ('a session id that is not a string', {'sessionId': 5}),
    ('an empty session id', {'sessionId': ''}),
    ('a session id that is too long', {'sessionId': 'x' * 65}),
    ('a token that is too short', {'token': 'abc'}),
    ('a token with characters that do not belong in a path', {'token': 'abcdefghijklmnop/../etc'}),
    ('a token that is not a string', {'token': 1234567890123456}),
    ('a netid that is not a number', {'netid': 'abc'}),
    ('a player who left', {'netid': 99}),
]:
    lua = stream_env()
    stream_start(lua, **fields)
    check(f'{label} is ignored', len(lua.eval('EVENTS')) == 0, client_events(lua))

# the upload endpoint
lua = stream_env()
stream_start(lua)
req, res = stream_post(lua)
cap = lua.eval('CAPTURED')
body = pyjson.loads(cap[1]['body'])
check('a frame is forwarded to the intercom with the server token and the session id the server chose', len(cap) == 1 and cap[1]['url'] == 'http://127.0.0.1:40120/intercom/screenstream' and cap[1]['method'] == 'POST' and body == {'txAdminToken': 'secrettoken', 'sessionId': 'sess1', 'frame': '/9j/AAAA'}, body)
check('the player is not answered before the core answered', res['sent'] is None)
lua.eval('CALLBACKS[1]')(200, '{"ok":true}')
check('then it gets ok, with open CORS so the game page can read it, and nothing cached', res['code'] == 200 and res['sent'] == '{"ok":true}' and res['headers']['Access-Control-Allow-Origin'] == '*' and res['headers']['Cache-Control'] == 'no-store' and res['headers']['X-Content-Type-Options'] == 'nosniff', (res['code'], res['sent']))

lua = stream_env()
stream_start(lua)
req, res = stream_post(lua)
lua.eval('CALLBACKS[1]')(200, '{"stop":true}')
check('when the core says stop, the player is told to stop', res['sent'] == '{"stop":true}', res['sent'])
req, res = stream_post(lua)
check('and the token no longer works', res['code'] == 404 and res['sent'] == '{"stop":true}' and len(lua.eval('CAPTURED')) == 1, res['code'])

lua = stream_env()
stream_start(lua)
req, res = stream_post(lua)
lua.eval('CALLBACKS[1]')(500, 'boom')
check('when the core cannot be reached, the player is told to stop too', res['sent'] == '{"stop":true}', res['sent'])

lua = stream_env()
req, res = stream_post(lua)
check('an unknown token gets 404 and the stop signal, nothing is forwarded', res['code'] == 404 and res['sent'] == '{"stop":true}' and len(lua.eval('CAPTURED')) == 0)
for path in ['/stream/', '/stream/../monitor/x', '/stream/abc/def', '/stream/%s?x=1' % TOKEN, '/streamx/' + TOKEN]:
    lua = stream_env()
    stream_start(lua)
    req, res = stream_post(lua, path=path)
    check(f'the path {path} is not a stream upload', len(lua.eval('CAPTURED')) == 0 and res['code'] in (404, 405), (path, res['code']))

lua = stream_env()
stream_start(lua)
req, res = stream_post(lua, method='OPTIONS', body=None)
check('a preflight gets 204 with the allowed method and headers', res['code'] == 204 and res['headers']['Access-Control-Allow-Origin'] == '*' and 'POST' in res['headers']['Access-Control-Allow-Methods'] and 'Content-Type' in res['headers']['Access-Control-Allow-Headers'])
req, res = stream_post(lua, method='GET', body=None)
check('GET is refused with 405', res['code'] == 405 and len(lua.eval('CAPTURED')) == 0)

# size limits
lua = stream_env()
stream_start(lua)
req, res = stream_post(lua, body='A' * 400001)
check('a body above 400000 characters is refused and not forwarded', res['code'] == 413 and len(lua.eval('CAPTURED')) == 0, res['code'])
lua = stream_env()
stream_start(lua)
req, res = stream_post(lua, headers=lua.eval('{ ["content-length"] = "5000000" }'), body=None)
check('a content-length above the limit is refused before the body is read', res['code'] == 413 and req['handler'] is None)
req, res = stream_post(lua, headers=lua.eval('{ ["Content-Length"] = "5000000" }'), body=None)
check('in any casing of the header', res['code'] == 413 and req['handler'] is None)
lua = stream_env()
stream_start(lua)
req, res = stream_post(lua, body='')
check('an empty body is not forwarded', len(lua.eval('CAPTURED')) == 0 and res['code'] == 413)

# pacing
lua = stream_env()
stream_start(lua)
stream_post(lua)
lua.eval('CALLBACKS[1]')(200, '{"ok":true}')
lua.execute('NOW = NOW + 10')
req, res = stream_post(lua)
check('a second frame less than 30 ms after the first is acked and dropped', res['sent'] == '{"ok":true}' and len(lua.eval('CAPTURED')) == 1, res['sent'])
lua.execute('NOW = NOW + 40')
req, res = stream_post(lua)
check('after 30 ms it is forwarded again', len(lua.eval('CAPTURED')) == 2)
req2, res2 = stream_post(lua)
lua.execute('NOW = NOW + 100')
req3, res3 = stream_post(lua)
check('a second frame can be on its way before the first one is answered (the client sends without waiting)', len(lua.eval('CAPTURED')) == 3, len(lua.eval('CAPTURED')))
lua.execute('NOW = NOW + 100')
req4, res4 = stream_post(lua)
check('but not a third: it is dropped and acked, there is no queue', len(lua.eval('CAPTURED')) == 3 and res4['sent'] == '{"ok":true}', len(lua.eval('CAPTURED')))
lua.eval('CALLBACKS[2]')(200, '{"ok":true}')
lua.execute('NOW = NOW + 100')
req5, res5 = stream_post(lua)
check('and once an answer came back there is room again', len(lua.eval('CAPTURED')) == 4)

# lifetime
lua = stream_env()
stream_start(lua, ttlMs=60000)
lua.execute('NOW = NOW + 60001')
req, res = stream_post(lua)
check('a token does not work after its lifetime', res['code'] in (404, 410) and res['sent'] == '{"stop":true}' and len(lua.eval('CAPTURED')) == 0, res['code'])

lua = stream_env()
stream_start(lua)
lua.eval('TX_EVENT_HANDLERS.screenStreamStop')(lua.eval('{ sessionId = "sess1" }'))
ev = lua.eval('EVENTS')
check('stopping tells the player game to stop', len(ev) == 2 and ev[2][1] == 'txcl:screenStreamStop' and ev[2][2] == 12, client_events(lua))
req, res = stream_post(lua)
check('and the token is dead', res['code'] == 404 and len(lua.eval('CAPTURED')) == 0)
lua.eval('TX_EVENT_HANDLERS.screenStreamStop')(lua.eval('{ sessionId = "unknown" }'))
lua.eval('TX_EVENT_HANDLERS.screenStreamStop')(lua.eval('{ sessionId = 5 }'))
check('stopping something unknown, or with a bad id, does nothing', len(lua.eval('EVENTS')) == 2)

lua = stream_env()
stream_start(lua)
stream_start(lua, sessionId='sess2', token='tok_second_abcdefghijk_1')
req, res = stream_post(lua)
check('a new stream on the same player replaces the old one (old token dead)', res['code'] == 404)
req, res = stream_post(lua, token='tok_second_abcdefghijk_1')
check('and the new one works', len(lua.eval('CAPTURED')) == 1)
check('the old stream was stopped on the player game', ('txcl:screenStreamStop', 12) in [(a, b) for a, b, c in client_events(lua)], client_events(lua))

lua = stream_env(players=tuple(str(i) for i in range(1, 20)))
for i in range(1, 12):
    stream_start(lua, sessionId=f's{i}', token=f'tok_number_{i:02d}_abcdefghijk', netid=i)
started = [e for e in client_events(lua) if e[0] == 'txcl:screenStreamStart']
check('at most 8 streams run at once on the server', len(started) == 8, len(started))

# GetGameTimer is a 32 bit number of milliseconds: it wraps after about 24.8 days of uptime
lua = stream_env()
lua.execute('NOW = 4294967200')
stream_start(lua, ttlMs=600000)
req, res = stream_post(lua)
lua.eval('CALLBACKS[1]')(200, '{"ok":true}')
lua.execute('NOW = (4294967200 + 100) % 4294967296')  # 4, the timer wrapped, 100 ms later
assert lua.eval('NOW') == 4
req, res = stream_post(lua)
check('a stream keeps going when the game timer wraps around (no frame dropped as too fast for days)', len(lua.eval('CAPTURED')) == 2 and res['sent'] is None, (len(lua.eval('CAPTURED')), res['sent']))
lua = stream_env()
lua.execute('NOW = 4294967000')
stream_start(lua, ttlMs=60000)
lua.execute('NOW = (4294967000 + 60001) % 4294967296')
req, res = stream_post(lua)
check('and the lifetime is still counted across the wrap', res['code'] in (404, 410) and len(lua.eval('CAPTURED')) == 0, res['code'])

# the client side: the game builds the url itself, from its own server endpoint
def client_stream_env(endpoint='1.2.3.4:30120'):
    lua = LuaRuntime(unpack_returned_tuples=True, register_eval=False)
    lua.execute(PRELUDE)
    lua.execute("""
    NUI = {}
    function sendMenuMessage(action, data) NUI[#NUI + 1] = { action = action, data = data } end
    function GetCurrentServerEndpoint() return %s end
    function GetCurrentResourceName() return 'monitor' end
    """ % (("'" + endpoint + "'") if endpoint is not None else 'nil'))
    lua.eval('load')(current('resource/cl_stream.lua'), 'cl_stream')()
    return lua

def cl_start(lua, **fields):
    data = {'token': TOKEN, 'fps': 12, 'width': 640, 'quality': 0.5, 'ttlMs': 600000}
    data.update(fields)
    tbl = lua.eval('{}')
    for k, v in data.items(): tbl[k] = v
    lua.eval('HANDLERS["txcl:screenStreamStart"]')(tbl)

print('[cl_stream.lua | the game side of the live view]')
lua = client_stream_env()
cl_start(lua)
nui = lua.eval('NUI')
check('the menu page gets the url made from the server endpoint, this resource and the token', len(nui) == 1 and nui[1]['action'] == 'screenStreamStart' and nui[1]['data']['url'] == f'http://1.2.3.4:30120/monitor/stream/{TOKEN}', nui[1]['data']['url'] if len(nui) else None)
check('with the capture settings', nui[1]['data']['fps'] == 12 and nui[1]['data']['width'] == 640 and abs(nui[1]['data']['quality'] - 0.5) < 1e-9 and nui[1]['data']['ttlMs'] == 600000)
lua.eval('HANDLERS["txcl:screenStreamStop"]')()
nui = lua.eval('NUI')
check('stopping reaches the menu page', len(nui) == 2 and nui[2]['action'] == 'screenStreamStop')
for label, fields in [('a token that is too short', {'token': 'abc'}), ('a token with a slash in it', {'token': 'abcdefghijklmnop/../x'}), ('a token that is not a string', {'token': 5})]:
    lua = client_stream_env()
    cl_start(lua, **fields)
    check(f'{label} is ignored', len(lua.eval('NUI')) == 0)
lua = client_stream_env()
lua.eval('HANDLERS["txcl:screenStreamStart"]')('not a table')
check('anything that is not a table is ignored', len(lua.eval('NUI')) == 0)
lua = client_stream_env(endpoint=None)
cl_start(lua)
check('without a server endpoint nothing is started', len(lua.eval('NUI')) == 0)
lua = client_stream_env()
cl_start(lua, fps=500, width=99999, quality=9, ttlMs=99999999)
d = lua.eval('NUI')[1]['data']
check('the settings are capped again on the game side', d['fps'] == 20 and d['width'] == 1280 and abs(d['quality'] - 0.8) < 1e-9 and d['ttlMs'] == 660000, dict(d))
lua = client_stream_env()
tbl = lua.eval('{ token = "%s", url = "http://evil.example/x", fps = 12 }' % TOKEN)
lua.eval('HANDLERS["txcl:screenStreamStart"]')(tbl)
check('a url sent by the server (or another resource) is never used', lua.eval('NUI')[1]['data']['url'] == f'http://1.2.3.4:30120/monitor/stream/{TOKEN}')

# the dispatch of txaEvent in sv_main.lua: events are broadcast to every resource, except the one that carries a token
def to_lua(lua, value):
    if isinstance(value, dict):
        t = lua.table()
        for k, v in value.items(): t[k] = to_lua(lua, v)
        return t
    if isinstance(value, list):
        t = lua.table()
        for i, v in enumerate(value): t[i + 1] = to_lua(lua, v)
        return t
    return value

def main_env():
    lua = LuaRuntime(unpack_returned_tuples=True, register_eval=False)
    lua.execute(PRELUDE)
    lua.execute("""
    COMMANDS, BROADCAST, HANDLED = {}, {}, {}
    function RegisterCommand(name, fn, restricted) COMMANDS[name] = fn end
    function SetHttpHandler(fn) HTTP_HANDLER = fn end
    function GetInvokingResource() return nil end
    function GetCurrentResourceName() return 'monitor' end
    function txPrintError(...) end
    function SetConvar() end
    function GetConvar(n, d)
      if n == 'txAdmin-luaComHost' then return '127.0.0.1:40120' end
      if n == 'txAdmin-luaComToken' then return 'secrettoken' end
      return d
    end
    function GetResourceMetadata() return '9.9.9' end
    function TriggerEvent(name, ...) BROADCAST[#BROADCAST + 1] = name end
    """)
    lua.globals().PYDECODE = lambda text: to_lua(lua, pyjson.loads(text))
    lua.execute("json.decode = PYDECODE")
    lua.eval('load')(current('resource/sv_main.lua'), 'main')()
    return lua

def tx_event(lua, name, data):
    args = lua.table(); args[1] = name; args[2] = pyjson.dumps(data)
    lua.eval('COMMANDS.txaEvent')(0, args)

print('[sv_main.lua | txaEvent dispatch]')
lua = main_env()
check('the txaEvent command is registered', lua.eval('type(COMMANDS.txaEvent)') == 'function')
tx_event(lua, 'healedPlayer', {'a': 1})
check('a normal event is broadcast to the other resources', list(lua.eval('BROADCAST').values()) == ['txAdmin:events:healedPlayer'], list(lua.eval('BROADCAST').values()))
lua = main_env()
lua.execute("TX_EVENT_HANDLERS.screenStreamStart = function(data) HANDLED[#HANDLED + 1] = data.sessionId end")
tx_event(lua, 'screenStreamStart', {'sessionId': 's1', 'token': 'tok_abcdefghijklmnop-1234'})
check('the live view start, which carries the upload token, is NOT broadcast to the other resources', 'txAdmin:events:screenStreamStart' not in list(lua.eval('BROADCAST').values()), list(lua.eval('BROADCAST').values()))
check('but its own handler still runs', list(lua.eval('HANDLED').values()) == ['s1'])
lua = main_env()
lua.execute("TX_EVENT_HANDLERS.screenStreamStop = function(data) HANDLED[#HANDLED + 1] = data.sessionId end")
tx_event(lua, 'screenStreamStop', {'sessionId': 's1'})
check('the stop (no secret in it) is still broadcast like the others', 'txAdmin:events:screenStreamStop' in list(lua.eval('BROADCAST').values()) and list(lua.eval('HANDLED').values()) == ['s1'])

# the server only wires the route when the file exists
sv_main = current('resource/sv_main.lua')
check('sv_main.lua sends /stream/ requests to the stream handler before anything else', "req.path:sub(1, 8) == '/stream/'" in sv_main and 'TX_STREAM_HTTP' in sv_main)
check('sv_main.lua lists both stream events in the whitelist', 'screenStreamStart = false' in sv_main and 'screenStreamStop = false' in sv_main)
check('the manifest loads sv_stream.lua and cl_stream.lua', "'resource/sv_stream.lua'" in current('fxmanifest.lua') and "'resource/cl_stream.lua'" in current('fxmanifest.lua'))

# ---------------------------------------------------------------- menu handlers: arguments sent by a client
MENU = 'resource/menu/server/'

def menu_env(file, use_old=False):
    lua = env((file, (old if use_old else current)(MENU + file)))
    lua.execute("""
      function GetPlayerName(id) if id == 5 or id == 6 or id == 7 then return 'player' .. id end return nil end
      function Player(id) return { state = {} } end
      function GetPlayers() return { '5', '6', '7' } end
      function tableIndexOf(t, v) for i, x in ipairs(t) do if x == v then return i end end return -1 end
      function GetPlayerRoutingBucket(id) if id == 7 or id == 99 then return 3 end return 0 end
      function SetPlayerRoutingBucket(id, bucket) BUCKETS[#BUCKETS + 1] = table.pack(id, bucket) end
      BUCKETS, DELETED, CREATED, PED_VEH = {}, {}, {}, 0
      function DeleteEntity(e) DELETED[#DELETED + 1] = e end
      function NetworkGetEntityFromNetworkId(n) if n == 77 then return 500 elseif n == 88 then return 600 end return 0 end
      function GetVehiclePedIsIn(ped) return PED_VEH end
      function GetEntityHeading() return 0.0 end
      function CreateVehicleServerSetter(model, kind) CREATED[#CREATED + 1] = table.pack(model, kind) return 900 end
      function DoesEntityExist() return true end
      function SetEntityRoutingBucket() end
      function SetEntityVelocity() end
      function NetworkGetNetworkIdFromEntity() return 1 end
      function call_co(name, src, ...)
        source = src
        local ok, err = coroutine.resume(coroutine.create(HANDLERS[name]), ...)
        if not ok then error(err) end
      end
    """)
    return lua

def sent(lua, name):
    return [e[2] for e in lua.eval('EVENTS').values() if e[1] == name]

def spectated(lua):
    return [e[3] for e in lua.eval('EVENTS').values() if e[1] == 'txcl:spectate:start']

def fire(lua, name, src, *args):
    lua.eval('call_event')(name, src, *args)

NAN = '(0/0)'

for ev, client in (('setDrunk', 'txcl:setDrunk'), ('setOnFire', 'txcl:setOnFire'), ('wildAttack', 'txcl:wildAttack')):
    print(f'[sv_trollactions.lua | {ev}]')
    lua = menu_env('sv_trollactions.lua')
    name = f'txsv:req:troll:{ev}'
    for bad in (-1, 99, 0, 6.5, '6'):
        fire(lua, name, 5, bad)
    fire(lua, name, 5, lua.eval(NAN))
    check('an id that is not a connected player reaches nobody (-1, unknown, 0, fractional, string, NaN)', sent(lua, client) == [], sent(lua, client))
    fire(lua, name, 9, 6)
    check('a player without the permission reaches nobody', sent(lua, client) == [])
    fire(lua, name, 5, 6)
    check('a connected target is reached', sent(lua, client) == [6], sent(lua, client))
    lua = menu_env('sv_trollactions.lua', use_old=True)
    fire(lua, name, 5, -1)
    check('base sends it to everybody with -1 (the bug is real)', sent(lua, client) == [-1], sent(lua, client))

print('[sv_freeze_player.lua]')
lua = menu_env('sv_freeze_player.lua')
for bad in (-1, 99, '6', 6.5):
    fire(lua, 'txsv:req:freezePlayer', 5, bad)
check('an id that is not a connected player freezes nobody', sent(lua, 'txcl:setFrozen') == [] and sent(lua, 'txcl:freezePlayerOk') == [])
fire(lua, 'txsv:req:freezePlayer', 5, 6)
fire(lua, 'txsv:req:freezePlayer', 5, 6)
states = [e[3] for e in lua.eval('EVENTS').values() if e[1] == 'txcl:setFrozen']
check('freezing a connected player toggles it', states == [True, False], states)
fire(lua, 'txsv:req:freezePlayer', 5, 6)
lua.execute('source = 6; LOCAL_HANDLERS.playerDropped()')
fire(lua, 'txsv:req:freezePlayer', 5, 6)
states = [e[3] for e in lua.eval('EVENTS').values() if e[1] == 'txcl:setFrozen']
check('the frozen state of a player who left is not inherited by the next one using that id', states[-2:] == [True, True], states)
lua = menu_env('sv_freeze_player.lua', use_old=True)
fire(lua, 'txsv:req:freezePlayer', 5, -1)
check('base freezes everybody with -1 (the bug is real)', sent(lua, 'txcl:setFrozen') == [-1], sent(lua, 'txcl:setFrozen'))

print('[sv_vehicle.lua | delete]')
lua = menu_env('sv_vehicle.lua')
lua.execute('PED_VEH = 500')
fire(lua, 'txsv:req:vehicle:delete', 5, 88)
fire(lua, 'txsv:req:vehicle:delete', 5, 0)
fire(lua, 'txsv:req:vehicle:delete', 5, 'x')
fire(lua, 'txsv:req:vehicle:delete', 9, 77)
check('only the vehicle the admin is in can be deleted (another entity, unknown id, string, no permission)', list(lua.eval('DELETED').values()) == [], list(lua.eval('DELETED').values()))
fire(lua, 'txsv:req:vehicle:delete', 5, 77)
check('the vehicle the admin is in is deleted', list(lua.eval('DELETED').values()) == [500], list(lua.eval('DELETED').values()))
lua = menu_env('sv_vehicle.lua', use_old=True)
lua.execute('PED_VEH = 500')
fire(lua, 'txsv:req:vehicle:delete', 5, 88)
check('base deletes any entity the admin names (the bug is real)', list(lua.eval('DELETED').values()) == [600], list(lua.eval('DELETED').values()))

print('[sv_vehicle.lua | spawn:fivem]')
lua = menu_env('sv_vehicle.lua')
fire(lua, 'txsv:req:vehicle:spawn:fivem', 5, 'adder', 'evil')
fire(lua, 'txsv:req:vehicle:spawn:fivem', 5, 'adder', None)
fire(lua, 'txsv:req:vehicle:spawn:fivem', 5, 'a' * 65, 'automobile')
check('a type outside the list or a model of 65 characters spawns nothing', len(lua.eval('CREATED')) == 0)
lua.eval('call_co')('txsv:req:vehicle:spawn:fivem', 5, 'adder', 'automobile')
created = [(c[1], c[2]) for c in lua.eval('CREATED').values()]
check('a valid model and type still spawns', created == [('adder', 'automobile')], created)

print('[sv_player_mode.lua]')
lua = menu_env('sv_player_mode.lua')
fire(lua, 'txsv:req:changePlayerMode', 5, 'godmode', lua.eval('{-1, -1, 6, 6, 99, "x", 5}'))
check('the effect goes once to each connected player of the list, and the list cannot broadcast', sent(lua, 'txcl:showPtfx') == [6, 5], sent(lua, 'txcl:showPtfx'))
check('the admin still gets the mode', sent(lua, 'txcl:setPlayerMode') == [5])
fire(lua, 'txsv:req:changePlayerMode', 5, 'godmode')
check('a missing list does not raise and still sets the mode', sent(lua, 'txcl:setPlayerMode') == [5, 5])
lua = menu_env('sv_player_mode.lua')
lua.execute("function GetPlayerName(id) if type(id) == 'number' and id >= 1 and id <= 300 then return 'p' end end")
fire(lua, 'txsv:req:changePlayerMode', 5, 'noclip', lua.eval('(function() local t = {} for i = 1, 300 do t[i] = i end return t end)()'))
check('at most 128 players of the list are reached', len(sent(lua, 'txcl:showPtfx')) == 128, len(sent(lua, 'txcl:showPtfx')))
lua = menu_env('sv_player_mode.lua', use_old=True)
fire(lua, 'txsv:req:changePlayerMode', 5, 'godmode', lua.eval('{-1, -1}'))
check('base relays the list as it comes, -1 included (the bug is real)', sent(lua, 'txcl:showPtfx') == [-1, -1], sent(lua, 'txcl:showPtfx'))

print('[sv_spectate.lua]')
lua = menu_env('sv_spectate.lua')
fire(lua, 'txsv:req:spectate:start', 5, 99)
fire(lua, 'txsv:req:spectate:start', 5, -1)
check('spectating a player who is not connected does nothing', spectated(lua) == [])
fire(lua, 'txsv:req:spectate:start', 5, 6)
check('spectating a connected player starts', spectated(lua) == [6], spectated(lua))
lua = menu_env('sv_spectate.lua')
fire(lua, 'txsv:req:spectate:cycle', 9, 6, True)
check('cycling without the permission does nothing, not even the work of the cycle', len(lua.eval('EVENTS')) == 0 and len(lua.eval('MENU_EVENTS')) == 0)
fire(lua, 'txsv:req:spectate:cycle', 5, 6, True)
check('the admin can still cycle to the next player', spectated(lua) == [7], spectated(lua))
lua = menu_env('sv_spectate.lua', use_old=True)
fire(lua, 'txsv:req:spectate:start', 5, 99)
check('base starts to spectate a player who is not connected (the bug is real)', spectated(lua) == [99], spectated(lua))

print('[sv_player_modal.lua | tpToPlayer]')
lua = menu_env('sv_player_modal.lua')
fire(lua, 'txsv:req:tpToPlayer', 5, 99)
fire(lua, 'txsv:req:tpToPlayer', 5, -1)
check('teleporting to a player who is not connected does not change the routing bucket', len(lua.eval('BUCKETS')) == 0)
fire(lua, 'txsv:req:tpToPlayer', 5, 7)
check('teleporting to a connected player in another bucket still follows it', len(lua.eval('BUCKETS')) == 1)
lua = menu_env('sv_player_modal.lua', use_old=True)
fire(lua, 'txsv:req:tpToPlayer', 5, 99)
check('base changes the routing bucket before knowing the target exists (the bug is real)', len(lua.eval('BUCKETS')) == 1)

print('[sv_main_page.lua | healPlayer, clearArea]')
lua = menu_env('sv_main_page.lua')
fire(lua, 'txsv:req:healPlayer', 5, -1)
fire(lua, 'txsv:req:healPlayer', 5, 99)
check('healing an id that is not a connected player reaches nobody', sent(lua, 'txcl:heal') == [])
fire(lua, 'txsv:req:healPlayer', 5, '6')
check('a connected target given as a string is still healed', sent(lua, 'txcl:heal') == [6], sent(lua, 'txcl:heal'))
for bad in (-1, 301, 99999, 'x'):
    fire(lua, 'txsv:req:clearArea', 5, bad)
fire(lua, 'txsv:req:clearArea', 5, lua.eval(NAN))
check('a radius outside 0 to 300 or not a number clears nothing', sent(lua, 'txcl:clearArea') == [])
fire(lua, 'txsv:req:clearArea', 5, 150)
fire(lua, 'txsv:req:clearArea', 5, 300)
check('a radius of the menu is still cleared', len(sent(lua, 'txcl:clearArea')) == 2)
lua = menu_env('sv_main_page.lua', use_old=True)
fire(lua, 'txsv:req:healPlayer', 5, -1)
check('base heals everybody through healPlayer with -1 (the bug is real)', sent(lua, 'txcl:heal') == [-1], sent(lua, 'txcl:heal'))

print('[sv_functions.lua | IsValidPlayerId with a GetPlayerName that answers a string for anything]')
lua = env()
lua.execute("function GetPlayerName() return 'anyone' end")
is_valid = lua.eval('IsValidPlayerId')
check('only a positive integer number passes, whatever GetPlayerName says',
      [is_valid(v) for v in (-1, 0, 6.5, '6', True, None)] == [False] * 6 and is_valid(6) is True and is_valid(lua.eval(NAN)) is False)
lua.execute("function GetPlayerName() return nil end")
check('a number that is not a connected player fails', is_valid(6) is False)

print('[sv_vehicle.lua | delete on RedM]')
lua = menu_env('sv_vehicle.lua')
lua.execute('IS_FIVEM = false; IS_REDM = true; PED_VEH = 500')
fire(lua, 'txsv:req:vehicle:delete', 5, 88)
fire(lua, 'txsv:req:vehicle:delete', 5, 0)
check('RedM keeps its behavior (the entity named by the admin) and never deletes entity 0', list(lua.eval('DELETED').values()) == [600], list(lua.eval('DELETED').values()))

print('[sv_player_modal.lua | bringPlayer]')
lua = menu_env('sv_player_modal.lua')
lua.execute("function GetPlayerPed(id) return 100 + (type(id) == 'number' and id or 0) end")
for bad in (-1, 99, 6.5, '6'):
    fire(lua, 'txsv:req:bringPlayer', 5, bad)
check('bringing an id that is not a connected player reaches nobody, even if GetPlayerPed answers', sent(lua, 'txcl:tpToCoords') == [], sent(lua, 'txcl:tpToCoords'))
fire(lua, 'txsv:req:bringPlayer', 5, 6)
check('bringing a connected player still works', sent(lua, 'txcl:tpToCoords') == [6], sent(lua, 'txcl:tpToCoords'))

print(f'\n{PASS} checks passed, {FAIL} failed')
sys.exit(1 if FAIL else 0)
