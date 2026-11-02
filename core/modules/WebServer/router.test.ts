//@ts-nocheck
import { suite, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import Koa from 'koa';

vi.mock('@core/globalData', () => ({ txDevEnv: { ENABLED: false }, txHostConfig: {} }));
vi.mock('@routes/index', () => new Proxy({}, {
    get: (_target, name) => (name === 'then' ? undefined : async (ctx) => { ctx.body = { route: String(name) }; }),
    has: () => true,
}));
vi.mock('./middlewares/authMws', () => {
    const pass = async (ctx, next) => next();
    const needsSession = async (ctx, next) => (ctx.get('x-test-session') ? next() : (ctx.status = 401));
    return { apiAuthMw: needsSession, hostAuthMw: pass, intercomAuthMw: pass, webAuthMw: pass };
});

import createRouter from './router';


const ATTEMPTS = 3;

const startServer = async () => {
    const app = new Koa();
    app.use((ctx, next) => {
        ctx.txVars = { realIP: ctx.get('x-test-ip') };
        return next();
    });
    app.use(createRouter().routes());
    const server = http.createServer(app.callback());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const post = async (path: string, ip: string, withSession = true) => {
        const headers: Record<string, string> = { 'x-test-ip': ip };
        if (withSession) headers['x-test-session'] = '1';
        const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers });
        return { status: res.status, body: await res.text() };
    };
    return { post, close: () => server.close() };
};

suite('router rate limits', () => {
    beforeEach(() => {
        vi.stubGlobal('txConfig', { webServer: { limiterMinutes: 15, limiterAttempts: ATTEMPTS } });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('limits the login attempts of one ip', async () => {
        const { post, close } = await startServer();
        try {
            for (let i = 0; i < ATTEMPTS; i++) {
                expect((await post('/auth/password', '203.0.113.9')).status).toBe(200);
            }
            const blocked = await post('/auth/password', '203.0.113.9');
            expect(blocked.status).toBe(429);
            expect(blocked.body).toContain('Too many attempts');
            expect((await post('/auth/password', '203.0.113.10')).status).toBe(200);
        } finally {
            close();
        }
    });

    it('limits the guesses of the current password on /auth/changePassword', async () => {
        const { post, close } = await startServer();
        try {
            for (let i = 0; i < ATTEMPTS; i++) {
                expect((await post('/auth/changePassword', '203.0.113.9')).status).toBe(200);
            }
            const blocked = await post('/auth/changePassword', '203.0.113.9');
            expect(blocked.status).toBe(429);
            expect(blocked.body).toContain('Too many attempts');
        } finally {
            close();
        }
    });

    it('does not spend the login attempts of an ip on /auth/changePassword requests that have no session', async () => {
        const { post, close } = await startServer();
        try {
            for (let i = 0; i < ATTEMPTS * 2; i++) {
                expect((await post('/auth/changePassword', '203.0.113.9', false)).status).toBe(401);
            }
            expect((await post('/auth/password', '203.0.113.9')).status).toBe(200);
        } finally {
            close();
        }
    });

    it('does not give a fresh bucket to every address of an ipv6 /64', async () => {
        const { post, close } = await startServer();
        try {
            for (let i = 0; i < ATTEMPTS; i++) {
                expect((await post('/auth/password', `2001:db8:1:2::${i + 1}`)).status).toBe(200);
            }
            expect((await post('/auth/password', '2001:db8:1:2:ffff::9')).status).toBe(429);
            expect((await post('/auth/password', '2001:db8:1:3::1')).status).toBe(200);
        } finally {
            close();
        }
    });
});
