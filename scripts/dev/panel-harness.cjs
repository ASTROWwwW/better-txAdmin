// A stand-in for the txAdmin core, only for looking at the panel in a browser without an FXServer:
// serves dist/panel with the injected constants and a socket.io server that sends status, playerlist and playermap
// (positions drifting every 2s). Everything else answers an empty object, so pages other than /map are mostly empty.
//
//   npm run build -w panel     (needs the .env of the CI, see .github/workflows/run-tests.yml)
//   PORT=4180 node scripts/dev/panel-harness.cjs
//   open http://127.0.0.1:4180/map
//
// ONESYNC=off shows the OneSync notice, PERMS=players.ban shows the access denied page.
// SHOT=ok|missing|expire|flaky plays the player screen viewer: frames drawn here, screenshot-basic missing,
// a session that runs out after 4 frames and continues when renewed, or a few failures before frames.
// GET /__calls lists what the screen viewer called.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Server } = require('socket.io');

const ROOT = path.resolve(__dirname, '../../dist/panel');
const PORT = parseInt(process.env.PORT || '4180', 10);
const ONESYNC = process.env.ONESYNC || 'on';
const PERMS = (process.env.PERMS || 'all_permissions').split(',');
const MUTEX = 'm1abc';

const consts = {
  fxsVersion: 'v1', fxsOutdated: false, txaVersion: '9.9.9', txaOutdated: false, serverTimezone: 'UTC', isWindows: false,
  isWebInterface: true, showAdvanced: false, hasMasterAccount: true, defaultTheme: 'dark', customThemes: [],
  providerLogo: undefined, providerName: undefined, hostConfigSource: 'test',
  server: { name: 'Test Server', game: 'fivem', icon: undefined },
  preAuth: { name: 'tester', permissions: PERMS, isMaster: PERMS.includes('all_permissions'), isTempPassword: false, csrfToken: 'x' },
};
const replacers = {
  basePath: '<base href="/">', customThemesStyle: '', devModules: '', htmlClasses: 'dark', ogDescripttion: 'x', ogTitle: 'x',
  txConstsInjection: `<script>window.txConsts = ${JSON.stringify(consts)};</script>`,
};
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace(/<!--\s*\{\{(\w+)\}\}\s*-->/g, (_m, name) => replacers[name] ?? '')
  .replace(/\{\{(\w+)\}\}/g, (_m, name) => replacers[name] ?? '');


// ---- fake player screenshots
const zlib = require('node:zlib');
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
const makePng = (frame) => {
  const W = 320, H = 180, raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const o = y * (W * 3 + 1) + 1 + x * 3;
      const bar = Math.abs(x - ((frame * 24) % W)) < 6;
      raw[o] = bar ? 255 : 30 + (x * 120) / W; raw[o + 1] = bar ? 255 : 60 + (y * 100) / H; raw[o + 2] = bar ? 255 : 140;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
};
const SHOT = process.env.SHOT || 'ok';
const calls = [];
let shotCount = 0, expired = false, flakyLeft = 3;
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } }); });
const playerModal = (url) => ({
  serverTime: Date.now(), banTemplates: [],
  player: { displayName: 'Player' + url.searchParams.get('netid'), pureName: 'player', isRegistered: true, isConnected: true, idsOffline: [], idsOnline: ['license:abc'], hwidsOffline: [], hwidsOnline: [], license: 'abc', actionHistory: [], netid: parseInt(url.searchParams.get('netid')) },
});
const json = (res, data) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
const handleApi = async (req, res, url) => {
  if (url.pathname === '/__calls') return json(res, calls);
  if (req.method === 'GET' && url.pathname === '/player') return json(res, playerModal(url));
  if (req.method === 'POST' && url.pathname === '/player/screenshot') {
    const body = await readBody(req);
    calls.push({ path: 'screenshot', renew: body.renew === true, at: Date.now() });
    await new Promise((r) => setTimeout(r, 150));
    if (SHOT === 'missing') return json(res, { error: 'The screenshot-basic resource is not started on this server.', code: 'screenshot_basic_missing' });
    if (SHOT === 'flaky' && flakyLeft > 0) { flakyLeft--; return json(res, { error: 'The player did not answer in time.', code: 'timeout' }); }
    if (SHOT === 'expire') {
      if (body.renew === true) expired = false;
      if (shotCount >= 4 && !body.renew) expired = true;
      if (expired) return json(res, { error: 'The viewing session ended after 10 minutes.', code: 'session_expired' });
      if (body.renew === true) shotCount = 0;
    }
    shotCount++;
    return json(res, { image: makePng(shotCount), ts: Date.now() });
  }
  if (req.method === 'POST' && url.pathname === '/player/screenshotStop') { calls.push({ path: 'stop', at: Date.now() }); return json(res, { success: true }); }
  return json(res, {});
};

const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.map': 'application/json' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const file = path.join(ROOT, path.normalize(url.pathname));
  if (url.pathname !== '/' && file.startsWith(ROOT) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    return fs.createReadStream(file).pipe(res);
  }
  if (url.pathname.startsWith('/socket.io')) return; // handled by socket.io
  if (/\.(js|css|png|jpg|svg|woff2|map)$/.test(url.pathname)) { res.writeHead(404); return res.end(); }
  if (url.pathname === '/' || !path.extname(url.pathname)) {
    if (/^\/player(\/|$)/.test(url.pathname) || url.pathname === '/__calls') { handleApi(req, res, url); return; }
    if (url.pathname.startsWith('/auth') || url.pathname.startsWith('/fxserver') || url.pathname.startsWith('/status')) {
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}');
    }
    res.writeHead(200, { 'content-type': 'text/html' }); return res.end(indexHtml);
  }
  res.writeHead(404); res.end();
});

// players: dense downtown, a few elsewhere, moving a little on every tick
let seed = 5; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const players = [];
const add = (x, y) => players.push({ netid: players.length + 1, name: `Player${players.length + 1}`, x, y, vType: rnd() < 0.3 ? 1 : 0 });
for (let i = 0; i < 40; i++) add(-250 + rnd() * 350, -900 + rnd() * 450);
for (let i = 0; i < 6; i++) add(1900 + rnd() * 80, 3700 + rnd() * 80);
add(-120, 6200); add(-118, 6203);
for (let i = 0; i < 30; i++) add(-3500 + rnd() * 8000, -3500 + rnd() * 11000);

const io = new Server(server, { transports: ['polling'], path: '/socket.io' });
const playerlist = () => [{ mutex: MUTEX, type: 'fullPlayerlist', playerlist: players.map((p) => ({ netid: p.netid, displayName: p.name, pureName: p.name.toLowerCase(), license: null })) }];
const mapData = () => ({ mutex: MUTEX, onesync: ONESYNC, ts: Date.now(), players: ONESYNC === 'off' ? [] : players.map((p) => [p.netid, Math.round(p.x), Math.round(p.y), p.vType]) });
const status = { configState: 2, discord: 0, runner: { isIdle: false, isChildAlive: true }, server: { name: 'Test Server', uptime: 60000, health: 2, healthReason: '', whitelist: 'disabled' }, scheduler: { nextRelativeMs: false, nextSkip: false, nextIsTemp: false, nextIsDelayed: false } };
io.on('connection', (socket) => {
  const rooms = String(socket.handshake.query.rooms || '').split(',');
  for (const room of rooms) {
    if (room === 'playermap' && !PERMS.some((p) => p === 'all_permissions' || p === 'players.spectate')) continue;
    socket.join(room);
    if (room === 'status') socket.emit('status', status);
    if (room === 'playerlist') socket.emit('playerlist', playerlist());
    if (room === 'playermap') { socket.emit('playermap', mapData()); console.log('joined playermap'); }
  }
});
setInterval(() => {
  for (const p of players) { p.x += (rnd() - 0.5) * 40; p.y += (rnd() - 0.5) * 40; }
  io.to('playermap').emit('playermap', mapData());
}, 2000);
server.listen(PORT, '127.0.0.1', () => console.log('harness on', PORT));
