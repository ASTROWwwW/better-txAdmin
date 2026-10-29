//@ts-nocheck
import { suite, it, describe, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import Koa from 'koa';
import Router from '@koa/router';

vi.mock('@core/globalData', () => ({ txEnv: { txaVersion: '9.9.9' }, txHostConfig: {}, txDevEnv: {} }));
//The top level middleware turns an error of a route into a logged line, the stream would still run: keep them
const { loggedErrors } = vi.hoisted(() => ({ loggedErrors: [] as string[] }));
vi.mock('@lib/console', () => {
    const noop = () => { };
    const verbose = { warn: noop, error: noop, log: noop, debug: noop, dir: noop };
    const error = (message: unknown) => { loggedErrors.push(String(message)); };
    return { default: () => ({ warn: noop, error, log: noop, debug: noop, verbose }) };
});
import topLevelMw from '@modules/WebServer/middlewares/topLevelMw';
import cacheControlMw from '@modules/WebServer/middlewares/cacheControlMw';
import { koaSessMw, SessionMemoryStorage } from '@modules/WebServer/middlewares/sessionMws';
import FxScreenStreams from '@modules/FxScreenStreams';
import ScreenStreamView from './screenStreamView';

const COOKIE = 'txAdmin-test';
const SESS_ID = '12345678-1234-1234-1234-123456789012'; //36 chars, what the session middleware accepts
const be16 = (n: number) => Buffer.from([(n >> 8) & 0xff, n & 0xff]);
//the size in the header is checked, the rest of the picture is not
const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]), be16(16), Buffer.alloc(14, 1),
    Buffer.from([0xff, 0xc0]), be16(17), Buffer.from([8]), be16(360), be16(640), Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    Buffer.from([0xff, 0xda]), be16(8), Buffer.alloc(6, 2), Buffer.alloc(40, 9), Buffer.from([0xff, 0xd9]),
]);
const FRAME = jpeg.toString('base64');

suite('screen stream view route (real http, real session and top level middlewares)', () => {
    let server: http.Server;
    let port: number;
    let streams: FxScreenStreams;
    let store: SessionMemoryStorage;
    let admins: Record<string, any>;
    let sessionAdmin: string | undefined;
    let viewers: { closed: number }; //one per test, a late close of an earlier test must not count here

    const startServer = async () => {
        const app = new Koa(); //like the web server, app.proxy stays off
        store = new SessionMemoryStorage();
        store.set(SESS_ID, { auth: { type: 'password', username: 'admin', password_hash: 'h', expiresAt: false, csrfToken: 'c' } });
        app.use(topLevelMw as any);
        app.use(cacheControlMw as any);
        app.use(koaSessMw(COOKIE, store) as any);
        app.use(async (ctx: any, next: any) => {
            ctx.utils = { error: (status: number, message: string) => { ctx.status = status; ctx.body = message; } };
            await next();
        });
        const router = new Router();
        router.get('/player/screenStream/:sessionId', ScreenStreamView as any);
        app.use(router.routes());
        server = http.createServer(app.callback());
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as any).port;
    };

    //Reads the response until `until` returns true or it ends, then drops the connection
    const get = (path: string, headers: Record<string, string> = { cookie: `${COOKIE}=${SESS_ID}` }, until?: (body: Buffer) => boolean) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
        const req = http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
            const chunks: Buffer[] = [];
            const finish = () => { req.destroy(); resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }); };
            res.on('data', (c) => { chunks.push(c); if (until?.(Buffer.concat(chunks))) finish(); });
            res.on('end', finish);
            res.on('error', () => { });
        });
        req.on('error', (e: any) => { if (e.code !== 'ECONNRESET') reject(e); });
    });

    beforeEach(async () => {
        loggedErrors.length = 0;
        admins = {
            admin: { name: 'admin', master: false, permissions: ['players.spectate'], password_hash: 'h' },
            other: { name: 'other', master: false, permissions: ['players.spectate'], password_hash: 'h' },
            nopower: { name: 'nopower', master: false, permissions: ['players.ban'], password_hash: 'h' },
        };
        sessionAdmin = 'admin';
        const mine = { closed: 0 };
        viewers = mine;
        vi.stubGlobal('txCore', {
            adminStore: { getAdminByName: (n: string) => admins[n] },
            cacheStore: { get: () => undefined },
            fxRunner: { child: { isAlive: true }, sendEvent: vi.fn() },
            logger: { admin: { write: vi.fn() } },
        });
        streams = new FxScreenStreams();
        txCore.fxScreenStreams = streams;
        //watching when viewers go away
        const attach = streams.attachViewer.bind(streams);
        streams.attachViewer = (...args: any[]) => { const detach = attach(...args); args[3].on('close', () => mine.closed++); return detach; }; //only counts the attached ones
        await startServer();
    });
    afterEach(async () => {
        await new Promise((r) => server.close(r));
        vi.unstubAllGlobals();
    });

    const startSession = (admin = 'admin') => streams.start(admin, { netid: 12, displayName: 'Bob', isConnected: true });

    describe('serving the stream', () => {
        it('streams frames as multipart/x-mixed-replace with safe headers', async () => {
            const s = startSession();
            const pending = get(`/player/screenStream/${s.sessionId}?t=${s.viewToken}`, undefined, (b) => b.includes(jpeg));
            await vi.waitFor(() => expect(viewers.closed).toBe(0));
            await new Promise((r) => setTimeout(r, 50));
            expect(streams.handleFrame(s.sessionId, FRAME)).toEqual({ ok: true });
            const res = await pending;
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toBe('multipart/x-mixed-replace; boundary=txframe');
            expect(res.headers['x-content-type-options']).toBe('nosniff');
            expect(res.headers['cache-control']).toContain('no-store');
            expect(res.body.toString('latin1')).toContain(`--txframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
            expect(res.body.includes(jpeg)).toBe(true);
        });

        it('works when the session cookie gets refreshed (no "headers already sent" error from the session middleware)', async () => {
            const s = startSession();
            const pending = get(`/player/screenStream/${s.sessionId}?t=${s.viewToken}`, undefined, (b) => b.includes(jpeg));
            await new Promise((r) => setTimeout(r, 50));
            streams.handleFrame(s.sessionId, FRAME);
            const res = await pending;
            expect(res.status).toBe(200);
            expect(res.body.includes(jpeg)).toBe(true);
            expect(loggedErrors).toEqual([]); //an error of the session middleware would only show up here
        });

        it('detaches the viewer when the browser closes the image', async () => {
            const s = startSession();
            const pending = get(`/player/screenStream/${s.sessionId}?t=${s.viewToken}`, undefined, (b) => b.includes(jpeg));
            await new Promise((r) => setTimeout(r, 50));
            streams.handleFrame(s.sessionId, FRAME);
            await pending; //destroys the request
            await vi.waitFor(() => expect(viewers.closed).toBe(1));
        });
    });

    describe('refusing', () => {
        const expectRefused = async (status: number, path: string, headers?: Record<string, string>) => {
            const res = await get(path, headers);
            expect(res.status).toBe(status);
            expect(res.headers['content-type'] ?? '').not.toContain('multipart');
            expect(viewers.closed).toBe(0);
        };

        it('403 without a session cookie', async () => {
            const s = startSession();
            await expectRefused(403, `/player/screenStream/${s.sessionId}?t=${s.viewToken}`, {});
        });

        it('403 for a cookie that is not a session', async () => {
            const s = startSession();
            await expectRefused(403, `/player/screenStream/${s.sessionId}?t=${s.viewToken}`, { cookie: `${COOKIE}=00000000-0000-0000-0000-000000000000` });
        });

        it('403 for an admin without the players.spectate permission', async () => {
            const s = startSession();
            store.set(SESS_ID, { auth: { type: 'password', username: 'nopower', password_hash: 'h', expiresAt: false, csrfToken: 'c' } });
            await expectRefused(403, `/player/screenStream/${s.sessionId}?t=${s.viewToken}`);
        });

        it('404 with a wrong, missing or repeated view token', async () => {
            const s = startSession();
            await expectRefused(404, `/player/screenStream/${s.sessionId}?t=wrong`);
            await expectRefused(404, `/player/screenStream/${s.sessionId}`);
            await expectRefused(404, `/player/screenStream/${s.sessionId}?t=${s.viewToken}&t=${s.viewToken}`);
        });

        it('404 for another admin, even with the right token', async () => {
            const s = startSession('other'); //started by someone else, watched with the cookie of "admin"
            await expectRefused(404, `/player/screenStream/${s.sessionId}?t=${s.viewToken}`);
        });

        it('404 for an unknown or an ended session', async () => {
            const s = startSession();
            streams.stop('admin', s.sessionId);
            await expectRefused(404, `/player/screenStream/${s.sessionId}?t=${s.viewToken}`);
            await expectRefused(404, `/player/screenStream/nope?t=x`);
        });
    });
});
