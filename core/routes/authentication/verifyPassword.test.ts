//@ts-nocheck
import { suite, it, expect, vi, beforeEach, afterEach } from 'vitest';

const warn = vi.hoisted(() => vi.fn());
vi.mock('@core/globalData', () => ({ txEnv: { txaVersion: '9.9.9' }, txHostConfig: {}, txDevEnv: {} }));
vi.mock('@lib/console', () => ({
    default: () => ({ warn, error: vi.fn(), log: vi.fn(), verbose: { warn: vi.fn(), error: vi.fn(), log: vi.fn(), dir: (e) => { throw e; } } }),
}));
import AuthVerifyPassword from './verifyPassword';

const PROXY_IP = '10.0.0.2';
const CLIENT_IP = '203.0.113.9';

suite('AuthVerifyPassword audit trail behind a proxy', () => {
    let ctx: any;
    let adminLog: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        warn.mockClear();
        adminLog = vi.fn();
        const admin = { name: 'boss', password_hash: 'hash', permissions: [], master: true, providers: {} };
        vi.stubGlobal('VerifyPasswordHash', (pass: string) => pass === 'right');
        vi.stubGlobal('txCore', {
            adminStore: {
                hasAdmins: () => true,
                getAdminByName: (name: string) => (name === 'boss' ? admin : undefined),
                genCsrfToken: () => 'csrf',
            },
            logger: { admin: { write: adminLog } },
            cacheStore: { get: () => undefined },
            metrics: { txRuntime: { loginOrigins: { count: vi.fn() }, loginMethods: { count: vi.fn() } } },
        });
        ctx = {
            ip: PROXY_IP, //what koa sees: the proxy socket
            txVars: { realIP: CLIENT_IP, hostType: 'other' },
            request: { query: {}, body: { username: 'boss', password: 'right' } },
            sessTools: { set: vi.fn() },
            send: vi.fn(),
        };
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('logs the real client ip on a wrong username', async () => {
        ctx.request.body.username = 'nobody';
        await AuthVerifyPassword(ctx);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(CLIENT_IP));
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining(PROXY_IP));
    });

    it('logs the real client ip on a wrong password', async () => {
        ctx.request.body.password = 'wrong';
        await AuthVerifyPassword(ctx);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(CLIENT_IP));
        expect(warn).not.toHaveBeenCalledWith(expect.stringContaining(PROXY_IP));
    });

    it('records the real client ip in the admin log on login', async () => {
        await AuthVerifyPassword(ctx);
        expect(adminLog).toHaveBeenCalledWith('boss', expect.stringContaining(CLIENT_IP));
        expect(adminLog).not.toHaveBeenCalledWith('boss', expect.stringContaining(PROXY_IP));
    });
});
