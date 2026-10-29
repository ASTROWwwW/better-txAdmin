//@ts-nocheck
import { suite, it, describe, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@lib/console', () => {
    const noop = () => { };
    const verbose = { warn: noop, error: noop, log: noop, debug: noop, dir: noop };
    return { default: () => ({ warn: noop, error: noop, log: noop, debug: noop, verbose }) };
});
vi.mock('@lib/player/playerClasses.js', () => ({ ServerPlayer: class ServerPlayer { }, DatabasePlayer: class DatabasePlayer { } }));
import { ScreenStreamError } from '@modules/FxScreenStreams';
import { ServerPlayer } from '@lib/player/playerClasses.js';
import { handleScreenStreamStart, handleScreenStreamStop, handleScreenStreamStatus } from './screenStreamActions';

const onlinePlayer = (extra = {}) => Object.assign(new ServerPlayer(), { netid: 12, displayName: 'Bob', isConnected: true, ...extra });

suite('player screen stream actions', () => {
    let start: ReturnType<typeof vi.fn>;
    let stop: ReturnType<typeof vi.fn>;
    let getStatus: ReturnType<typeof vi.fn>;
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
        start = vi.fn().mockReturnValue({ sessionId: 's1', viewToken: 'v1', fps: 12, width: 640, quality: 0.5 });
        stop = vi.fn();
        getStatus = vi.fn().mockReturnValue({ state: 'live', frames: 3, fps: 11.5, bytes: 100, ageMs: 4000 });
        vi.stubGlobal('txCore', { fxScreenStreams: { start, stop, getStatus } });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('start', () => {
        it('starts a stream for an admin who can spectate, on a player who is online', async () => {
            const resp = await handleScreenStreamStart(ctx({ fps: 15, width: 800, quality: 0.6 }), onlinePlayer());
            expect(resp).toEqual({ sessionId: 's1', viewToken: 'v1', fps: 12, width: 640, quality: 0.5 });
            expect(start).toHaveBeenCalledWith('admin', expect.objectContaining({ netid: 12 }), { fps: 15, width: 800, quality: 0.6 });
        });

        it('needs the players.spectate permission, and does not even ask the server without it', async () => {
            perms = ['players.ban'];
            expect(await handleScreenStreamStart(ctx(), onlinePlayer())).toEqual({ error: expect.stringContaining('permission'), code: 'no_permission' });
            expect(start).not.toHaveBeenCalled();
        });

        it('only works on a player who is on the server right now', async () => {
            expect(await handleScreenStreamStart(ctx(), { netid: 12, displayName: 'Bob' })).toMatchObject({ code: 'player_gone' });
            expect(start).not.toHaveBeenCalled();
        });

        it('passes only numbers as settings, everything else is left for the defaults', async () => {
            await handleScreenStreamStart(ctx({ fps: '15', width: { a: 1 }, quality: null }), onlinePlayer());
            await handleScreenStreamStart(ctx(undefined), onlinePlayer());
            expect(start.mock.calls[0][2]).toEqual({ fps: undefined, width: undefined, quality: undefined });
            expect(start.mock.calls[1][2]).toEqual({ fps: undefined, width: undefined, quality: undefined });
        });

        it.each([
            ['server_offline', 'not running'],
            ['player_gone', 'not online'],
            ['busy', 'already watching'],
            ['too_many', 'too many'],
        ])('turns %s into a readable message with its code', async (code, fragment) => {
            start.mockImplementation(() => { throw new ScreenStreamError(code); });
            const resp = await handleScreenStreamStart(ctx(), onlinePlayer());
            expect(resp.code).toBe(code);
            expect(resp.error.toLowerCase()).toContain(fragment);
        });

        it('does not leak the text of an unexpected error', async () => {
            start.mockImplementation(() => { throw new Error('secret internal detail'); });
            expect(await handleScreenStreamStart(ctx(), onlinePlayer())).toEqual({ error: 'Failed to start the live view.', code: 'unknown' });
        });
    });

    describe('stop and status', () => {
        it('stops a session by its id, for the admin who asks', async () => {
            expect(await handleScreenStreamStop(ctx({ sessionId: 's1' }))).toEqual({ success: true });
            expect(stop).toHaveBeenCalledWith('admin', 's1');
        });

        it('says not_found for a session that is not theirs, without more detail', async () => {
            stop.mockImplementation(() => { throw new ScreenStreamError('not_found'); });
            expect(await handleScreenStreamStop(ctx({ sessionId: 's1' }))).toMatchObject({ code: 'not_found' });
        });

        it.each([undefined, null, 12, {}, ['s1'], ''])('refuses a session id that is not a non empty string (%j)', async (sessionId) => {
            expect(await handleScreenStreamStop(ctx({ sessionId }))).toMatchObject({ code: 'not_found' });
            expect(await handleScreenStreamStatus(ctx({ sessionId }))).toMatchObject({ code: 'not_found' });
            expect(stop).not.toHaveBeenCalled();
            expect(getStatus).not.toHaveBeenCalled();
        });

        it('returns the status of the stream for the admin who started it', async () => {
            expect(await handleScreenStreamStatus(ctx({ sessionId: 's1' }))).toEqual({ state: 'live', frames: 3, fps: 11.5, bytes: 100, ageMs: 4000 });
            expect(getStatus).toHaveBeenCalledWith('s1', 'admin');
        });

        it('needs the permission for both', async () => {
            perms = [];
            expect(await handleScreenStreamStop(ctx({ sessionId: 's1' }))).toMatchObject({ code: 'no_permission' });
            expect(await handleScreenStreamStatus(ctx({ sessionId: 's1' }))).toMatchObject({ code: 'no_permission' });
            expect(stop).not.toHaveBeenCalled();
            expect(getStatus).not.toHaveBeenCalled();
        });
    });
});
