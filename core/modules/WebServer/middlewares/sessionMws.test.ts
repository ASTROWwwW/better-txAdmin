import { suite, it, expect } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Koa from 'koa';
import { isForwardedHttps, koaSessMw, SessionMemoryStorage } from './sessionMws';


suite('isForwardedHttps', () => {
    it('should accept a plain https value', () => {
        expect(isForwardedHttps('https')).toBe(true);
    });

    it('should be case-insensitive', () => {
        expect(isForwardedHttps('HTTPS')).toBe(true);
        expect(isForwardedHttps('Https')).toBe(true);
    });

    it('should reject http', () => {
        expect(isForwardedHttps('http')).toBe(false);
    });

    it('should use the first hop in a multi-proxy chain', () => {
        expect(isForwardedHttps('https, http')).toBe(true);
        expect(isForwardedHttps('http, https')).toBe(false);
    });

    it('should reject missing or malformed values', () => {
        expect(isForwardedHttps(undefined)).toBe(false);
        expect(isForwardedHttps('')).toBe(false);
        expect(isForwardedHttps(['https'])).toBe(false);
        expect(isForwardedHttps(123)).toBe(false);
    });
});


suite('koaSessMw cookie Secure flag', () => {
    const requestWithHeaders = async (headers: Record<string, string>) => {
        const app = new Koa(); //app.proxy stays disabled, like in the web server
        app.use(koaSessMw('txAdmin-test', new SessionMemoryStorage()) as any);
        app.use((ctx: any) => {
            ctx.sessTools.set({ tmpOauthLoginStateKern: 'test' });
            ctx.body = 'ok';
        });
        const server = http.createServer(app.callback());
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        try {
            const { port } = server.address() as AddressInfo;
            const res = await fetch(`http://127.0.0.1:${port}/`, { headers });
            return { status: res.status, setCookie: res.headers.get('set-cookie') ?? '' };
        } finally {
            server.close();
        }
    };

    it('does not set Secure on a plain http request', async () => {
        const res = await requestWithHeaders({});
        expect(res.status).toBe(200);
        expect(res.setCookie).toContain('txAdmin-test=');
        expect(res.setCookie.toLowerCase()).not.toContain('secure');
    });

    it('sets Secure when a proxy forwards an https request', async () => {
        const res = await requestWithHeaders({ 'x-forwarded-proto': 'https' });
        expect(res.status).toBe(200);
        expect(res.setCookie.toLowerCase()).toContain('secure');
    });

    it('does not set Secure when the proxy forwards plain http', async () => {
        const res = await requestWithHeaders({ 'x-forwarded-proto': 'http' });
        expect(res.status).toBe(200);
        expect(res.setCookie.toLowerCase()).not.toContain('secure');
    });
});


suite('koaSessMw session id on login', () => {
    const COOKIE = 'txAdmin-test';
    const PLANTED = '11111111-1111-4111-8111-111111111111';
    const AUTH = { type: 'password', username: 'admin', password_hash: 'hash', expires_at: false, csrfToken: 'csrf' };

    const startServer = async () => {
        const store = new SessionMemoryStorage();
        const app = new Koa();
        app.use(koaSessMw(COOKIE, store) as any);
        app.use(async (ctx: any) => {
            await Promise.resolve();
            if (ctx.path === '/anon') ctx.sessTools.set({ tmpOauthLoginStateKern: 'state' });
            if (ctx.path === '/login-then-fail') {
                ctx.sessTools.set({ auth: AUTH });
                ctx.sessTools.destroy();
            }
            if (ctx.path === '/login') ctx.sessTools.set({ auth: AUTH });
            if (ctx.path === '/login-other') ctx.sessTools.set({ auth: { ...AUTH, username: 'other' } });
            ctx.body = 'ok';
        });
        const server = http.createServer(app.callback());
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address() as AddressInfo;
        const call = async (path: string, cookieId?: string) => {
            const headers: Record<string, string> = cookieId ? { cookie: `${COOKIE}=${cookieId}` } : {};
            const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
            const issued = new RegExp(`${COOKIE}=([^;]+)`).exec(res.headers.get('set-cookie') ?? '')?.[1];
            return { issued };
        };
        return { store, call, close: () => server.close() };
    };

    it('does not keep a session id chosen by the client', async () => {
        const { store, call, close } = await startServer();
        try {
            const { issued } = await call('/login', PLANTED);
            expect(issued).toBeTruthy();
            expect(issued).not.toBe(PLANTED);
            expect(store.get(PLANTED)).toBeUndefined();
            expect(store.get(issued!)?.auth).toBeTruthy();
        } finally {
            close();
        }
    });

    it('gives a new id when an anonymous session logs in, and drops the old one', async () => {
        const { store, call, close } = await startServer();
        try {
            const { issued: anonId } = await call('/anon');
            expect(store.get(anonId!)?.auth).toBeUndefined();
            const { issued: loggedId } = await call('/login', anonId);
            expect(loggedId).toBeTruthy();
            expect(loggedId).not.toBe(anonId);
            expect(store.get(anonId!)).toBeUndefined();
            expect(store.get(loggedId!)?.auth).toBeTruthy();
        } finally {
            close();
        }
    });

    it('keeps the id when a session that is already logged in is written again', async () => {
        const { store, call, close } = await startServer();
        try {
            const { issued: loggedId } = await call('/login');
            const again = await call('/login', loggedId);
            expect(again.issued ?? loggedId).toBe(loggedId);
            expect(store.get(loggedId!)?.auth).toBeTruthy();
        } finally {
            close();
        }
    });

    it('gives a new id when a session that is logged in as someone logs in as another admin', async () => {
        const { store, call, close } = await startServer();
        try {
            const { issued: firstId } = await call('/login');
            const { issued: secondId } = await call('/login-other', firstId);
            expect(secondId).toBeTruthy();
            expect(secondId).not.toBe(firstId);
            expect(store.get(firstId!)).toBeUndefined();
            expect(store.get(secondId!)?.auth?.username).toBe('other');
        } finally {
            close();
        }
    });

    it('leaves no session behind when a login fails after the session was written', async () => {
        const { store, call, close } = await startServer();
        try {
            const { issued: anonId } = await call('/anon');
            expect(store.size).toBe(1);
            const { issued } = await call('/login-then-fail', anonId);
            expect(issued).toBe('unset');
            expect(store.size).toBe(0);
        } finally {
            close();
        }
    });

    it('keeps the id when an anonymous session is written again without logging in', async () => {
        const { store, call, close } = await startServer();
        try {
            const { issued: anonId } = await call('/anon');
            const again = await call('/anon', anonId);
            expect(again.issued ?? anonId).toBe(anonId);
            expect(store.get(anonId!)).toBeTruthy();
        } finally {
            close();
        }
    });
});
