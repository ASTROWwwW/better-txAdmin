//@ts-nocheck
import { suite, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import Koa from 'koa';
import { parseIpRanges } from '@lib/host/isIpInRanges';

const hostConfig = vi.hoisted(() => ({ proxyIpRanges: undefined as any }));
vi.mock('@core/globalData', () => ({ txHostConfig: hostConfig }));

import ctxVarsMw from './ctxVarsMw';


const LUA_TOKEN = 'lua-secret-token';

const requestVars = async (headers: Record<string, string> = {}) => {
    const app = new Koa(); //app.proxy stays disabled, like in the web server
    app.use(ctxVarsMw as any);
    app.use((ctx: any) => {
        ctx.body = ctx.txVars;
    });
    const server = http.createServer(app.callback());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        const { port } = server.address() as any;
        const res = await fetch(`http://127.0.0.1:${port}/`, { headers });
        return await res.json();
    } finally {
        server.close();
    }
};

suite('ctxVarsMw over real http', () => {
    beforeEach(() => {
        hostConfig.proxyIpRanges = undefined;
        vi.stubGlobal('txCore', { webServer: { luaComToken: LUA_TOKEN } });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('uses the socket address when proxy support is off, whatever the header says', async () => {
        const vars = await requestVars({ 'x-forwarded-for': '203.0.113.9' });
        expect(vars.realIP).toBe('127.0.0.1');
        expect(vars.isLocalRequest).toBe(true);
    });

    it('reads the client address from a trusted proxy', async () => {
        hostConfig.proxyIpRanges = parseIpRanges(['127.0.0.1']);
        const vars = await requestVars({ 'x-forwarded-for': '203.0.113.9' });
        expect(vars.realIP).toBe('203.0.113.9');
        expect(vars.isLocalRequest).toBe(false);
    });

    it('is not made local by a loopback address forged at the start of the chain', async () => {
        hostConfig.proxyIpRanges = parseIpRanges(['127.0.0.1']);
        const vars = await requestVars({ 'x-forwarded-for': '127.0.0.1, 203.0.113.9' });
        expect(vars.realIP).toBe('203.0.113.9');
        expect(vars.isLocalRequest).toBe(false);
    });

    it('is not made local by a forged first entry when the real client is ipv6, ip:port or mapped', async () => {
        hostConfig.proxyIpRanges = parseIpRanges(['127.0.0.1']);
        const cases: [string, string][] = [
            ['127.0.0.1, 2001:db8::1', '2001:db8::1'],
            ['127.0.0.1, 203.0.113.9:51234', '203.0.113.9'],
            ['127.0.0.1, ::ffff:203.0.113.9', '203.0.113.9'],
            ['2001:db8::1', '2001:db8::1'],
        ];
        for (const [header, expectedIp] of cases) {
            const vars = await requestVars({ 'x-forwarded-for': header });
            expect(vars.realIP, header).toBe(expectedIp);
            expect(vars.isLocalRequest, header).toBe(false);
        }
    });

    it('fails closed when the client entry cannot be read, keeping the request non local', async () => {
        hostConfig.proxyIpRanges = parseIpRanges(['127.0.0.1']);
        for (const header of ['127.0.0.1, unknown', '127.0.0.1, ', '198.51.100.1, garbage']) {
            const vars = await requestVars({ 'x-forwarded-for': header });
            expect(vars.realIP, header).toBe('unresolved');
            expect(vars.isLocalRequest, header).toBe(false);
        }
    });

    it('ignores the header when the peer is not a trusted proxy', async () => {
        hostConfig.proxyIpRanges = parseIpRanges(['10.0.0.0/8']);
        const vars = await requestVars({ 'x-forwarded-for': '203.0.113.9' });
        expect(vars.realIP).toBe('127.0.0.1');
    });

    it('takes the player ip from the webpipe identifiers when the token is right', async () => {
        const vars = await requestVars({
            'x-txadmin-token': LUA_TOKEN,
            'x-txadmin-identifiers': 'license:abc,ip:198.51.100.7',
        });
        expect(vars.realIP).toBe('198.51.100.7');
    });

    it('does not trust an identifiers header merged from a duplicated one', async () => {
        const vars = await requestVars({
            'x-txadmin-token': LUA_TOKEN,
            'x-txadmin-identifiers': 'ip:6.6.6.6, license:abc,ip:198.51.100.7',
        });
        expect(vars.realIP).toBe('127.0.0.1');
    });

    it('does not trust the identifiers header with a wrong token', async () => {
        const vars = await requestVars({
            'x-txadmin-token': 'wrong',
            'x-txadmin-identifiers': 'ip:198.51.100.7',
        });
        expect(vars.realIP).toBe('127.0.0.1');
    });
});
