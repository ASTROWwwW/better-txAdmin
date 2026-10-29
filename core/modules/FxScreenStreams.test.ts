//@ts-nocheck
import { suite, it, describe, expect, vi, beforeEach, afterEach } from 'vitest';
import FxScreenStreams, { ScreenStreamError } from './FxScreenStreams';

//A real picture is not needed: the signature (FFD8FF at the start, FFD9 at the end) and the size in the header are checked
const be16 = (n: number) => Buffer.from([(n >> 8) & 0xff, n & 0xff]);
const jpegBytes = (n = 50, width = 640, height = 360) => Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]), be16(16), Buffer.alloc(14, 1),
    Buffer.from([0xff, 0xc0]), be16(17), Buffer.from([8]), be16(height), be16(width), Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    Buffer.from([0xff, 0xda]), be16(8), Buffer.alloc(6, 2), Buffer.alloc(n, 7), Buffer.from([0xff, 0xd9]),
]);
const FRAME = jpegBytes().toString('base64');
const player = (extra = {}) => ({ netid: 12, displayName: 'Bob', isConnected: true, ...extra });
const fakeRes = () => {
    const chunks: Buffer[] = [];
    const listeners: Record<string, Function[]> = {};
    return {
        chunks,
        headers: undefined as any,
        writableNeedDrain: false,
        writeHead(status: number, headers: any) { this.status = status; this.headers = headers; },
        write(chunk: any) { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); return true; },
        end() { this.ended = true; },
        on(event: string, fn: Function) { (listeners[event] ??= []).push(fn); },
        emit(event: string) { (listeners[event] ?? []).forEach((fn) => fn()); },
        ended: false,
        status: 0,
    };
};

suite('FxScreenStreams', () => {
    let streams: FxScreenStreams;
    let child: { isAlive: boolean };
    let sendEvent: ReturnType<typeof vi.fn>;
    let log: ReturnType<typeof vi.fn>;
    let adminRecord: any;

    const start = (admin = 'admin', p = player(), opts = {}) => streams.start(admin, p, opts);
    const codeOf = (fn: () => unknown) => {
        try { fn(); } catch (error) { return (error as ScreenStreamError).code; }
        return 'ok';
    };

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 29, 12, 0, 0));
        child = { isAlive: true };
        sendEvent = vi.fn().mockReturnValue(true);
        log = vi.fn();
        adminRecord = { name: 'admin', master: false, permissions: ['players.spectate'] };
        vi.stubGlobal('txCore', {
            fxRunner: { get child() { return child; }, sendEvent },
            logger: { admin: { write: log } },
            adminStore: { getAdminByName: () => adminRecord },
        });
        streams = new FxScreenStreams();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    describe('starting a stream', () => {
        it('tells the server resource with an upload token and the capture settings, and returns what the panel needs', () => {
            const s = start();
            expect(sendEvent).toHaveBeenCalledTimes(1);
            const [name, data] = sendEvent.mock.calls[0];
            expect(name).toBe('screenStreamStart');
            expect(data).toMatchObject({ sessionId: s.sessionId, netid: 12, fps: 12, width: 640, quality: 0.5 });
            expect(data.token).toMatch(/^[A-Za-z0-9_-]{24,}$/);
            expect(data.token).not.toBe(s.sessionId);
            expect(s.viewToken).toMatch(/^[A-Za-z0-9_-]{24,}$/);
            expect(s.viewToken).not.toBe(data.token); //the player never learns the viewer token
            expect(data.ttlMs).toBeGreaterThanOrEqual(10 * 60_000);
            expect(s).toMatchObject({ fps: 12, width: 640, quality: 0.5 });
        });

        it('keeps the capture settings inside safe bounds', () => {
            start('a', player({ netid: 1 }), { fps: 500, width: 99999, quality: 5 });
            start('b', player({ netid: 2 }), { fps: 0, width: 1, quality: -1 }); //out of range numbers are clamped
            start('c', player({ netid: 3 }), { fps: 'x', width: NaN, quality: null }); //not a finite number: default
            const sent = sendEvent.mock.calls.map((c) => c[1]);
            expect(sent[0]).toMatchObject({ fps: 20, width: 1280, quality: 0.8 });
            expect(sent[1]).toMatchObject({ fps: 5, width: 320, quality: 0.2 });
            expect(sent[2]).toMatchObject({ fps: 12, width: 640, quality: 0.5 });
        });

        it('logs the start in the admin log', () => {
            start();
            expect(log).toHaveBeenCalledWith('admin', expect.stringMatching(/Started viewing the live screen of #12 \(Bob\)/));
        });

        it.each([
            ['server_offline', () => { child = { isAlive: false }; }, player()],
            ['player_gone', () => { }, player({ isConnected: false })],
        ])('refuses with %s', (code, setup, p) => {
            setup();
            expect(codeOf(() => start('admin', p))).toBe(code);
            expect(sendEvent).not.toHaveBeenCalled();
        });

        it('refuses a player another admin is already watching', () => {
            start('admin');
            expect(codeOf(() => start('other'))).toBe('busy');
        });

        it('replaces the previous stream of the same admin and player', () => {
            const first = start('admin');
            const second = start('admin');
            expect(second.sessionId).not.toBe(first.sessionId);
            expect(streams.handleFrame(first.sessionId, FRAME)).toEqual({ stop: true });
            expect(streams.handleFrame(second.sessionId, FRAME)).toEqual({ ok: true });
        });

        it('allows three streams at once, not four', () => {
            start('a', player({ netid: 1 }));
            start('b', player({ netid: 2 }));
            start('c', player({ netid: 3 }));
            expect(codeOf(() => start('d', player({ netid: 4 })))).toBe('too_many');
        });
    });

    describe('frames from the player', () => {
        it('accepts a jpeg, counts it and shows it to the viewer as a multipart part', () => {
            const s = start();
            const res = fakeRes();
            streams.attachViewer(s.sessionId, s.viewToken, 'admin', res);
            expect(res.headers['Content-Type']).toBe('multipart/x-mixed-replace; boundary=txframe');
            expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
            expect(res.headers['Cache-Control']).toContain('no-store');
            expect(streams.handleFrame(s.sessionId, FRAME)).toEqual({ ok: true });
            const body = Buffer.concat(res.chunks);
            expect(body.toString('latin1')).toContain(`--txframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpegBytes().length}\r\n\r\n`);
            expect(body.includes(jpegBytes())).toBe(true);
            expect(streams.getStatus(s.sessionId, 'admin')).toMatchObject({ state: 'live', frames: 1 });
        });

        it.each([
            ['an unknown session', 'nope-nope-nope-nope', FRAME],
            ['a non string frame', 'SESSION', { toString: () => FRAME }],
            ['characters outside base64', 'SESSION', FRAME.slice(0, 20) + '"onerror="x'],
            ['not a jpeg', 'SESSION', Buffer.from('<html><script>alert(1)</script></html>').toString('base64')],
            ['a png', 'SESSION', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40)]).toString('base64')],
            ['a jpeg that is cut', 'SESSION', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(40, 1)]).toString('base64')],
            ['a jpeg that declares 30000x30000 pixels (it would be decoded by the browser of the admin)', 'SESSION', jpegBytes(50, 30000, 30000).toString('base64')],
            ['a jpeg that declares 65535x65535 pixels', 'SESSION', jpegBytes(50, 65535, 65535).toString('base64')],
            ['a jpeg with no frame header, so no size', 'SESSION', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(50, 7), Buffer.from([0xff, 0xd9])]).toString('base64')],
            ['an empty frame', 'SESSION', ''],
            ['too much data', 'SESSION', 'A'.repeat(400_001)],
        ])('discards %s without showing anything', (_label, id, frame) => {
            const s = start();
            const res = fakeRes();
            streams.attachViewer(s.sessionId, s.viewToken, 'admin', res);
            const before = res.chunks.length;
            streams.handleFrame(id === 'SESSION' ? s.sessionId : id, frame as any);
            expect(res.chunks.length).toBe(before);
            expect(streams.getStatus(s.sessionId, 'admin')).toMatchObject({ frames: 0 });
        });

        it('discards a picture that is valid but bigger than 400000 characters in base64', () => {
            const s = start();
            const big = jpegBytes(310_000).toString('base64');
            expect(big.length).toBeGreaterThan(400_000);
            streams.handleFrame(s.sessionId, big);
            expect(streams.getStatus(s.sessionId, 'admin').frames).toBe(0);
            const fits = jpegBytes(290_000).toString('base64');
            expect(fits.length).toBeLessThan(400_000);
            vi.setSystemTime(Date.now() + 100);
            streams.handleFrame(s.sessionId, fits);
            expect(streams.getStatus(s.sessionId, 'admin').frames).toBe(1);
        });

        it('only takes strict base64: a valid picture with a character that does not belong in it is discarded', () => {
            const s = start();
            const half = Math.floor(FRAME.length / 2);
            for (const junk of [' ', '"', '\n', '<', '=']) {
                vi.setSystemTime(Date.now() + 100);
                streams.handleFrame(s.sessionId, FRAME.slice(0, half) + junk + FRAME.slice(half));
            }
            expect(streams.getStatus(s.sessionId, 'admin').frames).toBe(0);
        });

        it('discards a picture that is cut: a valid header but no end of image marker', () => {
            const s = start();
            streams.handleFrame(s.sessionId, jpegBytes().subarray(0, -2).toString('base64'));
            expect(streams.getStatus(s.sessionId, 'admin').frames).toBe(0);
            vi.setSystemTime(Date.now() + 100);
            streams.handleFrame(s.sessionId, FRAME);
            expect(streams.getStatus(s.sessionId, 'admin').frames).toBe(1);
        });

        it('tells the player to stop for a session that does not exist or has ended', () => {
            expect(streams.handleFrame('nope-nope-nope-nope', FRAME)).toEqual({ stop: true });
            const s = start();
            streams.stop('admin', s.sessionId);
            expect(streams.handleFrame(s.sessionId, FRAME)).toEqual({ stop: true });
        });

        it('drops frames that come faster than 30 per second instead of showing them', () => {
            const s = start();
            const res = fakeRes();
            streams.attachViewer(s.sessionId, s.viewToken, 'admin', res);
            streams.handleFrame(s.sessionId, FRAME);
            vi.setSystemTime(Date.now() + 10);
            expect(streams.handleFrame(s.sessionId, FRAME)).toEqual({ ok: true });
            expect(streams.getStatus(s.sessionId, 'admin').frames).toBe(1);
            vi.setSystemTime(Date.now() + 40);
            streams.handleFrame(s.sessionId, FRAME);
            expect(streams.getStatus(s.sessionId, 'admin').frames).toBe(2);
        });

        it('measures the frames per second the viewer really gets', () => {
            const s = start();
            for (let i = 0; i < 25; i++) {
                vi.setSystemTime(Date.now() + 100);
                streams.handleFrame(s.sessionId, FRAME);
            }
            const status = streams.getStatus(s.sessionId, 'admin');
            expect(status.fps).toBeGreaterThan(8);
            expect(status.fps).toBeLessThan(11);
        });
    });

    describe('the viewer side', () => {
        it('lets at most 3 viewers watch one stream (browser tabs), a 4th is refused and a freed place can be taken', () => {
            const s = start();
            const viewers = [fakeRes(), fakeRes(), fakeRes()];
            for (const res of viewers) streams.attachViewer(s.sessionId, s.viewToken, 'admin', res);
            expect(codeOf(() => streams.attachViewer(s.sessionId, s.viewToken, 'admin', fakeRes()))).toBe('too_many');
            viewers[0].emit('close');
            expect(codeOf(() => streams.attachViewer(s.sessionId, s.viewToken, 'admin', fakeRes()))).toBe('ok');
        });

        it('only lets the admin who started it watch, with the viewer token', () => {
            const s = start('admin');
            const attempts = [
                () => streams.attachViewer(s.sessionId, s.viewToken, 'other', fakeRes()),
                () => streams.attachViewer(s.sessionId, 'wrong-token-wrong-token-xx', 'admin', fakeRes()),
                () => streams.attachViewer('nope-nope-nope-nope', s.viewToken, 'admin', fakeRes()),
            ];
            for (const attempt of attempts) expect(codeOf(attempt)).toBe('not_found');
        });

        it('does not write to a viewer that has not drained, it drops the frame', () => {
            const s = start();
            const res = fakeRes();
            streams.attachViewer(s.sessionId, s.viewToken, 'admin', res);
            streams.handleFrame(s.sessionId, FRAME);
            const written = res.chunks.length;
            res.writableNeedDrain = true;
            vi.setSystemTime(Date.now() + 100);
            streams.handleFrame(s.sessionId, FRAME);
            expect(res.chunks.length).toBe(written);
            expect(streams.getStatus(s.sessionId, 'admin').frames).toBe(2);
        });

        it('reports the state while waiting, once live, and after the end', () => {
            const s = start();
            expect(streams.getStatus(s.sessionId, 'admin')).toMatchObject({ state: 'waiting', frames: 0 });
            streams.handleFrame(s.sessionId, FRAME);
            expect(streams.getStatus(s.sessionId, 'admin').state).toBe('live');
            streams.stop('admin', s.sessionId);
            expect(streams.getStatus(s.sessionId, 'admin')).toMatchObject({ state: 'ended', reason: 'closed' });
        });

        it('does not give the status of someone else\'s session', () => {
            const s = start('admin');
            expect(codeOf(() => streams.getStatus(s.sessionId, 'other'))).toBe('not_found');
        });
    });

    describe('how a stream ends', () => {
        const endedWith = (s) => streams.getStatus(s.sessionId, 'admin');

        it('ends when the admin stops it, tells the server resource and the viewer, and logs it', () => {
            const s = start();
            const res = fakeRes();
            streams.attachViewer(s.sessionId, s.viewToken, 'admin', res);
            streams.handleFrame(s.sessionId, FRAME);
            sendEvent.mockClear();
            streams.stop('admin', s.sessionId);
            expect(sendEvent).toHaveBeenCalledWith('screenStreamStop', { sessionId: s.sessionId });
            expect(res.ended).toBe(true);
            expect(log).toHaveBeenCalledWith('admin', expect.stringMatching(/Stopped viewing the live screen of #12 \(Bob\) after 1 frames?.*\(closed\)/));
        });

        it('ends 15 seconds after the last viewer went away', async () => {
            const s = start();
            const res = fakeRes();
            streams.attachViewer(s.sessionId, s.viewToken, 'admin', res);
            res.emit('close');
            await vi.advanceTimersByTimeAsync(14_000);
            expect(endedWith(s).state).not.toBe('ended');
            await vi.advanceTimersByTimeAsync(6_000);
            expect(endedWith(s)).toMatchObject({ state: 'ended', reason: 'no_viewer' });
        });

        it('keeps going when the viewer comes back inside those 15 seconds', async () => {
            const s = start();
            const first = fakeRes();
            streams.attachViewer(s.sessionId, s.viewToken, 'admin', first);
            first.emit('close');
            await vi.advanceTimersByTimeAsync(8_000);
            streams.attachViewer(s.sessionId, s.viewToken, 'admin', fakeRes());
            for (let i = 0; i < 20; i++) { //the player keeps sending, otherwise it would fail to start
                streams.handleFrame(s.sessionId, FRAME);
                await vi.advanceTimersByTimeAsync(1_000);
            }
            expect(endedWith(s).state).toBe('live');
        });

        it('ends a stream that never got a viewer after 15 seconds', async () => {
            const s = start();
            await vi.advanceTimersByTimeAsync(21_000);
            expect(endedWith(s).state).toBe('ended');
        });

        it('says it failed to start when the player sent nothing within 12 seconds', async () => {
            const s = start();
            streams.attachViewer(s.sessionId, s.viewToken, 'admin', fakeRes());
            await vi.advanceTimersByTimeAsync(13_000);
            expect(endedWith(s)).toMatchObject({ state: 'ended', reason: 'failed_to_start' });
        });

        it('ends as stalled when a stream that was running gets no frame for 20 seconds (player left, game closed)', async () => {
            const s = start();
            streams.attachViewer(s.sessionId, s.viewToken, 'admin', fakeRes());
            streams.handleFrame(s.sessionId, FRAME);
            await vi.advanceTimersByTimeAsync(18_000);
            expect(endedWith(s).state).toBe('live');
            await vi.advanceTimersByTimeAsync(4_000);
            expect(endedWith(s)).toMatchObject({ state: 'ended', reason: 'stalled' });
            expect(sendEvent).toHaveBeenCalledWith('screenStreamStop', { sessionId: s.sessionId });
        });

        it.each([
            ['the admin was deleted', () => { adminRecord = undefined; }],
            ['the admin lost the permission', () => { adminRecord = { name: 'admin', master: false, permissions: ['players.ban'] }; }],
        ])('ends as revoked within a second when %s, and the viewer is cut', async (_name, change) => {
            const s = start();
            const res = fakeRes();
            streams.attachViewer(s.sessionId, s.viewToken, 'admin', res);
            streams.handleFrame(s.sessionId, FRAME);
            change();
            await vi.advanceTimersByTimeAsync(1_500);
            expect(endedWith(s)).toMatchObject({ state: 'ended', reason: 'revoked' });
            expect(res.ended).toBe(true);
            expect(sendEvent).toHaveBeenCalledWith('screenStreamStop', { sessionId: s.sessionId });
        });

        it.each([
            ['a master admin', { name: 'admin', master: true, permissions: [] }],
            ['all_permissions', { name: 'admin', master: false, permissions: ['all_permissions'] }],
        ])('keeps the stream of %s', async (_name, record) => {
            const s = start();
            adminRecord = record;
            await vi.advanceTimersByTimeAsync(3_000);
            expect(endedWith(s).state).not.toBe('ended');
        });

        it('ends at 10 minutes even between two frames, it does not wait for the next one', async () => {
            const s = start();
            streams.attachViewer(s.sessionId, s.viewToken, 'admin', fakeRes());
            for (let i = 0; i < 119; i++) { //a frame every 5 seconds, the last one at 595 s
                streams.handleFrame(s.sessionId, FRAME);
                await vi.advanceTimersByTimeAsync(5_000);
            }
            expect(endedWith(s).state).toBe('live');
            await vi.advanceTimersByTimeAsync(6_000);
            expect(endedWith(s)).toMatchObject({ state: 'ended', reason: 'time_limit' });
        });

        it('ends after 10 minutes and has to be started again on purpose', async () => {
            const s = start();
            streams.attachViewer(s.sessionId, s.viewToken, 'admin', fakeRes());
            for (let i = 0; i < 61; i++) {
                await vi.advanceTimersByTimeAsync(10_000);
                streams.handleFrame(s.sessionId, FRAME);
            }
            expect(endedWith(s)).toMatchObject({ state: 'ended', reason: 'time_limit' });
            expect(streams.handleFrame(s.sessionId, FRAME)).toEqual({ stop: true });
        });

        it('ends everything when the server closes', () => {
            const s = start();
            const res = fakeRes();
            streams.attachViewer(s.sessionId, s.viewToken, 'admin', res);
            streams.handleServerClose();
            expect(endedWith(s)).toMatchObject({ state: 'ended', reason: 'server_closed' });
            expect(res.ended).toBe(true);
        });

        it('writes the stop line of every open stream when txAdmin shuts down, and cuts the viewers', () => {
            const s = start();
            const res = fakeRes();
            streams.attachViewer(s.sessionId, s.viewToken, 'admin', res);
            streams.handleFrame(s.sessionId, FRAME);
            const other = start('other', player({ netid: 13, displayName: 'Eve' }));
            streams.stop('other', other.sessionId); //already over, must not be logged twice
            log.mockClear();
            sendEvent.mockClear();
            streams.handleShutdown();
            const stops = log.mock.calls.filter((c) => /Stopped viewing/.test(c[1]));
            expect(stops).toHaveLength(1);
            expect(stops[0][1]).toMatch(/#12 \(Bob\).*\(shutdown\)/);
            expect(res.ended).toBe(true);
            expect(sendEvent).not.toHaveBeenCalled(); //the server goes down with txAdmin
            streams.handleShutdown();
            expect(log.mock.calls.filter((c) => /Stopped viewing/.test(c[1]))).toHaveLength(1);
        });

        it('forgets an ended session after a minute', async () => {
            const s = start();
            streams.stop('admin', s.sessionId);
            await vi.advanceTimersByTimeAsync(70_000);
            expect(codeOf(() => streams.getStatus(s.sessionId, 'admin'))).toBe('not_found');
        });

        it('frees the slot of an ended stream', () => {
            const a = start('a', player({ netid: 1 }));
            start('b', player({ netid: 2 }));
            start('c', player({ netid: 3 }));
            streams.stop('a', a.sessionId);
            expect(codeOf(() => start('d', player({ netid: 4 })))).toBe('ok');
        });
    });
});
