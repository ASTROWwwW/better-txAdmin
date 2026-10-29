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
