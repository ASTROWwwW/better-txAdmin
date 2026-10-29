//@ts-nocheck
import { suite, it, describe, expect, vi, beforeEach, afterEach } from 'vitest';
import FxScreenshots, { ScreenshotError } from './FxScreenshots';

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD';
const player = (extra = {}) => ({ netid: 12, displayName: 'Bob', isConnected: true, ...extra });

suite('FxScreenshots', () => {
    let shots: FxScreenshots;
    let child: { isAlive: boolean };
    let sendEvent: ReturnType<typeof vi.fn>;
    let log: ReturnType<typeof vi.fn>;

    const lastReqId = () => sendEvent.mock.calls.at(-1)[1].reqId;
    const answer = (extra = {}, reqId = lastReqId()) => shots.handleResult({ reqId, image: JPEG, ...extra });
    const codeOf = async (promise: Promise<unknown>) => {
        try { await promise; } catch (error) { return (error as ScreenshotError).code; }
        return 'resolved';
    };

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 29, 12, 0, 0));
        child = { isAlive: true };
        sendEvent = vi.fn().mockReturnValue(true);
        log = vi.fn();
        vi.stubGlobal('txCore', {
            fxRunner: { get child() { return child; }, sendEvent },
            logger: { admin: { write: log } },
        });
        shots = new FxScreenshots();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('asks the server for one screenshot and resolves with the frame the server sends back', async () => {
        const promise = shots.capture('admin', player());
        expect(sendEvent).toHaveBeenCalledTimes(1);
        const [eventName, data] = sendEvent.mock.calls[0];
        expect(eventName).toBe('screenshotRequested');
        expect(data).toMatchObject({ netid: 12, quality: 0.4 });
        expect(data.reqId).toMatch(/^[A-Za-z0-9_-]{16,}$/);
        answer();
        await expect(promise).resolves.toEqual({ image: JPEG, ts: Date.now() });
    });

    it('uses a different request id every time', async () => {
        const first = shots.capture('admin', player());
        const id1 = lastReqId();
        answer();
        await first;
        vi.setSystemTime(Date.now() + 2000);
        const second = shots.capture('admin', player());
        expect(lastReqId()).not.toBe(id1);
        answer();
        await second;
    });

    describe('refusing a capture', () => {
        it('when the player is not connected', async () => {
            expect(await codeOf(shots.capture('admin', player({ isConnected: false })))).toBe('player_gone');
            expect(sendEvent).not.toHaveBeenCalled();
        });

        it('when the server is not running', async () => {
            child = { isAlive: false };
            expect(await codeOf(shots.capture('admin', player()))).toBe('server_offline');
            child = undefined;
            expect(await codeOf(shots.capture('admin', player()))).toBe('server_offline');
            expect(sendEvent).not.toHaveBeenCalled();
        });

        it('while a capture of the same player is waiting, even for another admin', async () => {
            const first = shots.capture('admin', player());
            expect(await codeOf(shots.capture('other', player()))).toBe('busy');
            answer();
            await first;
        });

        it('when the same player was asked less than a second ago', async () => {
            const first = shots.capture('admin', player());
            answer();
            await first;
            vi.setSystemTime(Date.now() + 500);
            expect(await codeOf(shots.capture('admin', player()))).toBe('too_fast');
            vi.setSystemTime(Date.now() + 600);
            const again = shots.capture('admin', player());
            answer();
            await again;
        });

        it('when five captures are already waiting', async () => {
            const waiting = [1, 2, 3, 4, 5].map((netid) => shots.capture('admin', player({ netid })));
            expect(await codeOf(shots.capture('admin', player({ netid: 6 })))).toBe('too_many');
            waiting.forEach((p, i) => { p.catch(() => { }); });
            shots.handleServerClose();
        });
    });

    describe('what the server answers', () => {
        it('times out after 8 seconds, and a late answer is ignored', async () => {
            const promise = shots.capture('admin', player());
            const reqId = lastReqId();
            const outcome = codeOf(promise);
            await vi.advanceTimersByTimeAsync(8000);
            expect(await outcome).toBe('timeout');
            expect(() => shots.handleResult({ reqId, image: JPEG })).not.toThrow();
        });

        it('ignores an answer for a request nobody made, and a second answer for a settled one', async () => {
            shots.handleResult({ reqId: 'nope-nope-nope-nope', image: JPEG });
            const promise = shots.capture('admin', player());
            const reqId = lastReqId();
            shots.handleResult({ reqId, image: JPEG });
            await promise;
            expect(() => shots.handleResult({ reqId, image: 'data:image/jpeg;base64,AAAA' })).not.toThrow();
        });

        it.each([
            'screenshot_basic_missing',
            'player_gone',
            'capture_failed',
        ])('passes on the known error %s', async (error) => {
            const promise = shots.capture('admin', player());
            const outcome = codeOf(promise);
            shots.handleResult({ reqId: lastReqId(), error });
            expect(await outcome).toBe(error);
        });

        it('turns any other error text into capture_failed, it is never relayed', async () => {
            const promise = shots.capture('admin', player());
            const outcome = codeOf(promise);
            shots.handleResult({ reqId: lastReqId(), error: '<script>alert(1)</script>' });
            expect(await outcome).toBe('capture_failed');
        });

        it.each([
            ['not a data uri', 'https://example.com/x.jpg'],
            ['a svg', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='],
            ['html', 'data:text/html;base64,PGgxPg=='],
            ['characters outside base64', 'data:image/jpeg;base64,AA"onerror="x'],
            ['a space', 'data:image/jpeg;base64,AA AA'],
            ['a non string', { toString: () => JPEG }],
            ['an empty payload', 'data:image/jpeg;base64,'],
            ['too much data', 'data:image/jpeg;base64,' + 'A'.repeat(600_001)],
        ])('refuses an image that is %s', async (_label, image) => {
            const promise = shots.capture('admin', player());
            const outcome = codeOf(promise);
            shots.handleResult({ reqId: lastReqId(), image });
            expect(await outcome).toBe('invalid_image');
        });

        it('accepts a png as well', async () => {
            const promise = shots.capture('admin', player());
            const png = 'data:image/png;base64,iVBORw0KGgo=';
            shots.handleResult({ reqId: lastReqId(), image: png });
            expect((await promise).image).toBe(png);
        });
    });

    it('rejects everything that is waiting when the server closes', async () => {
        const promise = shots.capture('admin', player());
        const outcome = codeOf(promise);
        shots.handleServerClose();
        expect(await outcome).toBe('server_closed');
    });

    describe('the audit log of a viewing session', () => {
        const frame = async (admin = 'admin', p = player()) => {
            vi.setSystemTime(Date.now() + 1100);
            const promise = shots.capture(admin, p);
            answer();
            await promise;
        };

        it('logs the start once, however many frames follow', async () => {
            await frame();
            await frame();
            await frame();
            const starts = log.mock.calls.filter((c) => /Started viewing/.test(c[1]));
            expect(starts).toHaveLength(1);
            expect(starts[0][0]).toBe('admin');
            expect(starts[0][1]).toContain('#12');
            expect(starts[0][1]).toContain('Bob');
        });

        it('logs the stop with the number of frames when the viewer stops', async () => {
            await frame();
            await frame();
            shots.stopViewing('admin', 12);
            const stops = log.mock.calls.filter((c) => /Stopped viewing/.test(c[1]));
            expect(stops).toHaveLength(1);
            expect(stops[0][1]).toContain('2 frames');
        });

        it('closes a session nobody is watching anymore after 15 seconds', async () => {
            await frame();
            await vi.advanceTimersByTimeAsync(21_000);
            expect(log.mock.calls.filter((c) => /Stopped viewing/.test(c[1]))).toHaveLength(1);
            await frame();
            expect(log.mock.calls.filter((c) => /Started viewing/.test(c[1]))).toHaveLength(2);
        });

        it('keeps one session per admin and player', async () => {
            await frame('admin');
            await frame('other');
            expect(log.mock.calls.filter((c) => /Started viewing/.test(c[1]))).toHaveLength(2);
        });

        it('stops a session after 10 minutes of viewing and only starts a new one on purpose', async () => {
            for (let i = 0; i < 60; i++) { //a frame every 10 seconds for 10 minutes
                vi.setSystemTime(Date.now() + 10_000);
                const promise = shots.capture('admin', player());
                answer();
                await promise;
            }
            vi.setSystemTime(Date.now() + 10_000);
            expect(await codeOf(shots.capture('admin', player()))).toBe('session_expired');
            vi.setSystemTime(Date.now() + 2_000);
            expect(await codeOf(shots.capture('admin', player()))).toBe('session_expired'); //still refused
            expect(log.mock.calls.filter((c) => /Stopped viewing/.test(c[1]))).toHaveLength(1);

            vi.setSystemTime(Date.now() + 2_000);
            const renewed = shots.capture('admin', player(), { renew: true });
            answer();
            await expect(renewed).resolves.toBeDefined();
            expect(log.mock.calls.filter((c) => /Started viewing/.test(c[1]))).toHaveLength(2);
        });

        it('lets an admin who comes back later start over without renewing', async () => {
            for (let i = 0; i < 60; i++) {
                vi.setSystemTime(Date.now() + 10_000);
                const promise = shots.capture('admin', player());
                answer();
                await promise;
            }
            vi.setSystemTime(Date.now() + 10_000);
            await codeOf(shots.capture('admin', player()));
            await vi.advanceTimersByTimeAsync(21_000); //nobody asks for 21 seconds, the tombstone is cleaned
            const fresh = shots.capture('admin', player());
            answer();
            await expect(fresh).resolves.toBeDefined();
        });
    });
});
