//@ts-nocheck
import { suite, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@lib/console', () => {
    const noop = () => { };
    const verbose = { warn: noop, error: noop, log: noop, debug: noop, dir: noop };
    return { default: () => ({ warn: noop, error: noop, log: noop, debug: noop, verbose }) };
});
vi.mock('@lib/player/playerClasses.js', () => ({ ServerPlayer: class ServerPlayer { }, DatabasePlayer: class DatabasePlayer { } }));
import { ScreenshotError } from '@modules/FxScreenshots';
import { ServerPlayer } from '@lib/player/playerClasses.js';
import { handleScreenshot, handleScreenshotStop } from './screenshotActions';

const onlinePlayer = (extra = {}) => Object.assign(new ServerPlayer(), { netid: 12, displayName: 'Bob', isConnected: true, ...extra });

suite('player screenshot actions', () => {
    let capture: ReturnType<typeof vi.fn>;
    let stopViewing: ReturnType<typeof vi.fn>;
    let perms: string[];
    const ctx = (body: any = {}) => ({
        admin: {
            name: 'admin',
            testPermission: (perm: string) => perms.includes(perm) || perms.includes('all_permissions'),
        },
        request: { body },
    });

    beforeEach(() => {
        perms = ['players.spectate'];
        capture = vi.fn().mockResolvedValue({ image: 'data:image/jpeg;base64,AAAA', ts: 5 });
        stopViewing = vi.fn();
        vi.stubGlobal('txCore', { fxScreenshots: { capture, stopViewing } });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('returns the frame for an admin who can spectate, for a player who is online', async () => {
        const resp = await handleScreenshot(ctx(), onlinePlayer());
        expect(resp).toEqual({ image: 'data:image/jpeg;base64,AAAA', ts: 5 });
        expect(capture).toHaveBeenCalledWith('admin', expect.objectContaining({ netid: 12 }), { renew: false });
    });

    it('needs the players.spectate permission, and does not even ask the server without it', async () => {
        perms = ['players.ban'];
        const resp = await handleScreenshot(ctx(), onlinePlayer());
        expect(resp).toEqual({ error: expect.stringContaining('permission'), code: 'no_permission' });
        expect(capture).not.toHaveBeenCalled();
    });

    it('only works on a player who is on the server right now', async () => {
        const resp = await handleScreenshot(ctx(), { netid: 12, displayName: 'Bob' }); //a database player
        expect(resp).toMatchObject({ code: 'player_gone' });
        expect(capture).not.toHaveBeenCalled();
    });

    it('passes the renew flag only when it is exactly true', async () => {
        await handleScreenshot(ctx({ renew: true }), onlinePlayer());
        await handleScreenshot(ctx({ renew: 'yes' }), onlinePlayer());
        await handleScreenshot(ctx(undefined), onlinePlayer());
        expect(capture.mock.calls.map((c) => c[2].renew)).toEqual([true, false, false]);
    });

    it.each([
        ['player_gone', 'not online'],
        ['server_offline', 'not running'],
        ['server_closed', 'not running'],
        ['timeout', 'did not answer'],
        ['session_expired', '10 minutes'],
        ['screenshot_basic_missing', 'screenshot-basic'],
        ['capture_failed', 'could not take'],
        ['invalid_image', 'invalid image'],
        ['busy', 'too often'],
        ['too_fast', 'too often'],
        ['too_many', 'too many'],
    ])('turns the %s error into a readable message with its code', async (code, fragment) => {
        capture.mockRejectedValue(new ScreenshotError(code));
        const resp = await handleScreenshot(ctx(), onlinePlayer());
        expect(resp.code).toBe(code);
        expect(resp.error.toLowerCase()).toContain(fragment.toLowerCase());
    });

    it('does not leak the text of an unexpected error', async () => {
        capture.mockRejectedValue(new Error('secret internal detail'));
        const resp = await handleScreenshot(ctx(), onlinePlayer());
        expect(resp).toEqual({ error: 'Failed to take the screenshot.', code: 'unknown' });
    });

    it('closes the viewing session', async () => {
        expect(await handleScreenshotStop(ctx(), onlinePlayer())).toEqual({ success: true });
        expect(stopViewing).toHaveBeenCalledWith('admin', 12);
    });

    it('does not let an admin without the permission close another session, or probe for one', async () => {
        perms = [];
        expect(await handleScreenshotStop(ctx(), onlinePlayer())).toMatchObject({ code: 'no_permission' });
        expect(stopViewing).not.toHaveBeenCalled();
    });
});
