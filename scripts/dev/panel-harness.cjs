// A stand-in for the txAdmin core, only for looking at the panel in a browser without an FXServer:
// serves dist/panel with the injected constants and a socket.io server that sends status, playerlist and playermap
// (positions drifting every 2s). Everything else answers an empty object, so pages other than /map are mostly empty.
//
//   npm run build -w panel     (needs the .env of the CI, see .github/workflows/run-tests.yml)
//   PORT=4180 node scripts/dev/panel-harness.cjs
//   open http://127.0.0.1:4180/map
//
// ONESYNC=off shows the OneSync notice, PERMS=players.ban shows the access denied page.
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
    if (url.pathname.startsWith('/auth') || url.pathname.startsWith('/fxserver') || url.pathname.startsWith('/player') || url.pathname.startsWith('/status')) {
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
