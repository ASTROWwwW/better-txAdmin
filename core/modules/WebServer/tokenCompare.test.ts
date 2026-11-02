//@ts-nocheck
import { suite, it, expect, vi, beforeEach, afterEach } from 'vitest';

const globals = vi.hoisted(() => ({
    txEnv: { isZapHosting: false },
    txHostConfig: { hostApiToken: 'host-api-token-value' },
}));
vi.mock('@core/globalData', () => globals);
vi.mock('@lib/safeEqual', async (importOriginal) => {
    const actual = await importOriginal();
    return { safeEqual: vi.fn(actual.safeEqual) };
});

import { getLogBuffer } from '@lib/console';
import { safeEqual } from '@lib/safeEqual';
import { nuiAuthLogic } from './authLogic';
import { hostAuthMw, intercomAuthMw } from './middlewares/authMws';
import ctxVarsMw from './middlewares/ctxVarsMw';


const LUA_TOKEN = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefgh';

suite('secret comparisons', () => {
    beforeEach(() => {
        vi.mocked(safeEqual).mockClear();
        vi.stubGlobal('txConfig', { webServer: { disableNuiSourceCheck: false } });
        vi.stubGlobal('txCore', {
            webServer: { luaComToken: LUA_TOKEN },
            adminStore: { getAdminByIdentifiers: () => undefined },
        });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    const nuiHeaders = (token: unknown) => ({ 'x-txadmin-token': token, 'x-txadmin-identifiers': 'license:abc' });

    it('compares the nui token with safeEqual and refuses a wrong one of the same length', () => {
        const wrong = LUA_TOKEN.slice(0, -1) + 'z';
        const resp = nuiAuthLogic('127.0.0.1', true, nuiHeaders(wrong));
        expect(resp.success).toBe(false);
        expect(resp.rejectReason).toBe('Unauthorized: token value');
        expect(safeEqual).toHaveBeenCalledWith(wrong, LUA_TOKEN);
    });

    it('lets the right nui token through to the admin lookup', () => {
        const resp = nuiAuthLogic('127.0.0.1', true, nuiHeaders(LUA_TOKEN));
        expect(resp.rejectReason).toBe('nui_admin_not_found');
    });

    it('does not write the received or the current token in the log', () => {
        const hostile = 'HOSTILE'.repeat(2000);
        nuiAuthLogic('127.0.0.1', true, nuiHeaders(hostile));
        const log = getLogBuffer();
        expect(log).not.toContain('HOSTILEHOSTILE');
        expect(log).not.toContain(LUA_TOKEN.slice(0, 6));
        expect(log).not.toContain(LUA_TOKEN.slice(-6));
    });

    const runIntercom = async (body: unknown) => {
        const ctx = { request: { body }, send: vi.fn() };
        const next = vi.fn();
        await intercomAuthMw(ctx, next);
        return { ctx, next };
    };

    it('compares the intercom token with safeEqual', async () => {
        const { ctx, next } = await runIntercom({ txAdminToken: LUA_TOKEN });
        expect(next).toHaveBeenCalledTimes(1);
        expect(ctx.send).not.toHaveBeenCalled();
        expect(safeEqual).toHaveBeenCalledWith(LUA_TOKEN, LUA_TOKEN);
    });

    it('refuses a wrong, missing or non string intercom token', async () => {
        for (const body of [{ txAdminToken: LUA_TOKEN.slice(0, -1) + 'z' }, { txAdminToken: [LUA_TOKEN] }, {}, undefined]) {
            const { ctx, next } = await runIntercom(body);
            expect(next).not.toHaveBeenCalled();
            expect(ctx.send).toHaveBeenCalledWith({ error: 'invalid token' });
        }
    });

    it('compares the webpipe token that carries the player ip with safeEqual', () => {
        const ctx = {
            headers: { 'x-txadmin-token': LUA_TOKEN, 'x-txadmin-identifiers': 'license:abc,ip:198.51.100.7' },
            ip: '127.0.0.1',
            request: { host: 'localhost:40120' },
        };
        ctxVarsMw(ctx, () => {});
        expect(safeEqual).toHaveBeenCalledWith(LUA_TOKEN, LUA_TOKEN);
        expect(ctx.txVars.realIP).toBe('198.51.100.7');
    });

    const runHost = async (headers: Record<string, string>) => {
        const ctx = { headers, query: {}, send: vi.fn() };
        const next = vi.fn();
        await hostAuthMw(ctx, next);
        return { ctx, next };
    };

    it('compares the host api token with safeEqual', async () => {
        const good = await runHost({ 'x-txadmin-envtoken': 'host-api-token-value' });
        expect(good.next).toHaveBeenCalledTimes(1);
        expect(safeEqual).toHaveBeenCalledWith('host-api-token-value', 'host-api-token-value');

        const bad = await runHost({ 'x-txadmin-envtoken': 'host-api-token-valuf' });
        expect(bad.next).not.toHaveBeenCalled();
        expect(bad.ctx.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'invalid token' }));
    });
});
