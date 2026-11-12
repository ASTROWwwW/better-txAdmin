//@ts-nocheck
import { suite, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@lib/console', () => {
    const noop = () => { };
    const verbose = { warn: noop, error: noop, log: noop, debug: noop, dir: noop };
    return { default: () => ({ warn: noop, error: noop, log: noop, debug: noop, verbose }) };
});
vi.mock('@lib/fxserver/fxsConfigHelper', () => ({ resolveCFGFilePath: (cfgPath: string) => cfgPath }));
vi.mock('@lib/fs', () => ({ getFsErrorMdMessage: () => 'fs error' }));
vi.mock('@modules/Translator', () => ({ default: {}, localeFileSchema: {} }));
vi.mock('@modules/DiscordBot/commands/status', () => ({ generateStatusMessage: vi.fn() }));
vi.mock('@modules/ConfigStore', () => ({ default: { Schema: { server: { cfgPath: { validator: { safeParse: (x: any) => ({ success: true, data: x }) } } } } } }));
vi.mock('@lib/fxserver/serverData', () => ({
    findPotentialServerDataPaths: vi.fn(),
    isValidServerDataPath: vi.fn().mockResolvedValue(true),
    stripServerCfgFromPath: (x: string) => x,
}));
vi.mock('node:fs/promises', () => ({ default: { stat: vi.fn().mockResolvedValue({ isFile: () => true }) } }));
import SaveSettingsConfigs from './saveConfigs';

suite('settings save: server scope', () => {
    let perms: string[];
    let saveConfigs: ReturnType<typeof vi.fn>;
    let sent: any[];
    const ctx = (card: string, body: any) => ({
        admin: {
            name: 'admin',
            testPermission: (perm: string) => perms.includes(perm) || perms.includes('all_permissions'),
        },
        params: { card },
        request: { body },
        send: (data: any) => { sent.push(data); },
    });

    beforeEach(() => {
        perms = ['settings.write'];
        sent = [];
        saveConfigs = vi.fn().mockReturnValue({ hasMatch: () => false, list: [] });
        vi.stubGlobal('txConfig', { server: { dataPath: '/srv/data', cfgPath: 'server.cfg', startupArgs: [] } });
        vi.stubGlobal('txCore', {
            configStore: { saveConfigs },
            webServer: { webSocket: { pushRefresh: vi.fn() } },
            cacheStore: { set: vi.fn() },
            fxRunner: { sendEvent: vi.fn() },
            metrics: { txRuntime: { settingsSaves: { count: vi.fn() } } },
            logger: { admin: { write: vi.fn(), writeSystem: vi.fn() } },
        });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('refuses server settings sent through another card', async () => {
        await SaveSettingsConfigs(ctx('bans', { resetKeys: [], changes: { server: { cfgPath: '/etc/passwd' } } }));
        expect(sent[0]).toMatchObject({ type: 'error', msg: expect.stringContaining('FXServer card') });
        expect(saveConfigs).not.toHaveBeenCalled();
    });

    it('refuses a server reset key sent through another card', async () => {
        await SaveSettingsConfigs(ctx('bans', { resetKeys: ['server.cfgPath'], changes: {} }));
        expect(sent[0]).toMatchObject({ type: 'error' });
        expect(saveConfigs).not.toHaveBeenCalled();
    });

    it('refuses a new cfg path, data path or startup args without all permissions', async () => {
        for (const server of [
            { dataPath: '/srv/data', cfgPath: '/etc/passwd' },
            { dataPath: '/', cfgPath: 'server.cfg' },
            { dataPath: '/srv/data', cfgPath: 'server.cfg', startupArgs: ['+exec', 'x.cfg'] },
        ]) {
            sent = [];
            await SaveSettingsConfigs(ctx('fxserver', { resetKeys: [], changes: { server } }));
            expect(sent[0]).toMatchObject({ type: 'error', msg: expect.stringContaining('all permissions') });
        }
        await SaveSettingsConfigs(ctx('fxserver', { resetKeys: ['server.startupArgs'], changes: { server: { dataPath: '/srv/data' } } }));
        expect(sent.at(-1)).toMatchObject({ type: 'error', msg: expect.stringContaining('all permissions') });
        expect(saveConfigs).not.toHaveBeenCalled();
    });

    it('lets settings.write save the fxserver card when the host values are unchanged', async () => {
        await SaveSettingsConfigs(ctx('fxserver', {
            resetKeys: [],
            changes: { server: { dataPath: '/srv/data/', cfgPath: 'server.cfg', startupArgs: [], onesync: 'on' } },
        }));
        expect(sent[0]?.msg ?? '').not.toContain('all permissions');
        expect(saveConfigs).toHaveBeenCalled();
    });

    it('lets an admin with all permissions change the host values', async () => {
        perms = ['all_permissions'];
        await SaveSettingsConfigs(ctx('fxserver', {
            resetKeys: [],
            changes: { server: { dataPath: '/srv/other', cfgPath: 'other.cfg' } },
        }));
        expect(saveConfigs).toHaveBeenCalled();
    });
});
