import { suite, it, describe, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameStream, type StreamDeps, type StreamStart } from './streamLoop';

const CFG: StreamStart = { url: 'http://1.2.3.4:30120/monitor/stream/tok_abcdefghijklmnop', fps: 10, width: 640, quality: 0.5, ttlMs: 60_000 };

suite('GameStream loop', () => {
    let clock: number;
    let capture: ReturnType<typeof vi.fn>;
    let send: ReturnType<typeof vi.fn>;
    let released: number;
    let deps: StreamDeps;
    //Every sleep waits for the test to move the clock, so the loop never runs on its own
    let sleeps: { ms: number; resolve: () => void }[];
    const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
    const tick = async () => {
        await flush();
        const next = sleeps.shift();
        if (next) { clock += next.ms; next.resolve(); }
        await flush();
    };

    beforeEach(() => {
        clock = 0;
        released = 0;
        sleeps = [];
        capture = vi.fn().mockImplementation(async () => { clock += 20; return 'FRAME'; }); //encoding takes 20 ms
        send = vi.fn().mockImplementation(async () => { clock += 30; return 'ok'; }); //the round trip takes 30 ms
        deps = {
            source: { capture, release: () => { released++; } },
            send,
            now: () => clock,
            sleep: (ms) => new Promise<void>((resolve) => sleeps.push({ ms, resolve })),
        };
    });

    describe('pacing', () => {
        it('sends a frame, waits for the answer, then waits for the rest of the frame time', async () => {
            const stream = new GameStream(deps);
            stream.start(CFG);
            await flush();
            expect(capture).toHaveBeenCalledWith(640, 0.5);
            expect(send).toHaveBeenCalledWith(CFG.url, 'FRAME');
            //10 fps is 100 ms per frame, 50 ms were used
            expect(sleeps.map((s) => s.ms)).toEqual([50]);
            await tick();
            expect(send).toHaveBeenCalledTimes(2);
        });

        it('does not wait at all when the frame took longer than the frame time (slow link)', async () => {
            send.mockImplementation(async () => { clock += 400; return 'ok'; });
            const stream = new GameStream(deps);
            stream.start(CFG);
            await flush();
            expect(sleeps.map((s) => s.ms)).toEqual([0]);
        });

        it('does not wait for the answer before capturing the next frame (the round trip would cap the fps)', async () => {
            const answers: ((v: 'ok') => void)[] = [];
            send.mockImplementation(() => new Promise((resolve) => { answers.push(resolve as any); }));
            const stream = new GameStream(deps);
            stream.start(CFG);
            await flush();
            expect(send).toHaveBeenCalledTimes(1);
            await tick();
            expect(send).toHaveBeenCalledTimes(2); //the first answer is still missing
        });

        it('has at most 2 frames in flight: the third capture waits for an answer', async () => {
            const answers: ((v: 'ok') => void)[] = [];
            send.mockImplementation(() => new Promise((resolve) => { answers.push(resolve as any); }));
            const stream = new GameStream(deps);
            stream.start(CFG);
            await flush();
            await tick();
            await tick();
            await tick();
            expect(send).toHaveBeenCalledTimes(2);
            expect(capture).toHaveBeenCalledTimes(2); //no picture is made for nothing
            answers[0]('ok');
            await flush();
            await tick();
            expect(send).toHaveBeenCalledTimes(3);
            expect(answers.length).toBe(3);
        });
    });

    describe('stopping', () => {
        it('stops when the server says stop and releases the source', async () => {
            send.mockResolvedValueOnce('stop');
            const stream = new GameStream(deps);
            stream.start(CFG);
            await flush();
            expect(stream.running).toBe(false);
            expect(released).toBe(1);
            await tick();
            expect(send).toHaveBeenCalledTimes(1);
        });

        it('stops on the stop message from the game, even in the middle of a frame', async () => {
            let answer: (v: 'ok') => void = () => { };
            send.mockImplementation(() => new Promise((resolve) => { answer = resolve as any; }));
            const stream = new GameStream(deps);
            stream.start(CFG);
            await flush();
            stream.stop();
            answer('ok');
            await tick(); //the loop wakes up from its wait and finds out
            expect(stream.running).toBe(false);
            expect(send).toHaveBeenCalledTimes(1);
            expect(released).toBe(1);
        });

        it('stops at once when a late answer says stop, even if the loop is waiting', async () => {
            let answer: (v: 'stop') => void = () => { };
            send.mockImplementation(() => new Promise((resolve) => { answer = resolve as any; }));
            const stream = new GameStream(deps);
            stream.start(CFG);
            await flush();
            answer('stop');
            await flush();
            expect(stream.running).toBe(false);
            expect(released).toBe(1);
            await tick();
            expect(send).toHaveBeenCalledTimes(1); //and nothing else was sent
        });

        it('stop is harmless when nothing runs, and twice', () => {
            const stream = new GameStream(deps);
            stream.stop();
            stream.stop();
            expect(stream.running).toBe(false);
        });

        it('ends by itself after the lifetime it was given', async () => {
            const stream = new GameStream(deps);
            stream.start({ ...CFG, ttlMs: 1000 }); //1 s is also the shortest life it accepts
            for (let i = 0; i < 30 && stream.running; i++) await tick();
            expect(stream.running).toBe(false);
            expect(clock).toBeGreaterThanOrEqual(1000);
            expect(clock).toBeLessThan(1200);
            expect(released).toBe(1);
        });

        it('gives up after 5 failures in a row, with a growing wait between them', async () => {
            send.mockResolvedValue('error');
            const stream = new GameStream(deps);
            stream.start(CFG);
            await flush();
            for (let i = 0; i < 10 && stream.running; i++) await tick();
            expect(send).toHaveBeenCalledTimes(5);
            expect(stream.running).toBe(false);
        });

        it('keeps going after a failure when the next frame works', async () => {
            send.mockResolvedValueOnce('error').mockResolvedValueOnce('error').mockResolvedValue('ok');
            const stream = new GameStream(deps);
            stream.start(CFG);
            await flush();
            for (let i = 0; i < 6; i++) await tick();
            expect(stream.running).toBe(true);
            expect(send.mock.calls.length).toBeGreaterThanOrEqual(5);
        });

        it('counts a capture that gave nothing, or threw, as a failure', async () => {
            capture.mockResolvedValue(null);
            const stream = new GameStream(deps);
            stream.start(CFG);
            await flush();
            for (let i = 0; i < 10 && stream.running; i++) await tick();
            expect(send).not.toHaveBeenCalled();
            expect(stream.running).toBe(false);

            capture.mockRejectedValue(new Error('webgl lost'));
            const second = new GameStream(deps);
            second.start(CFG);
            await flush();
            for (let i = 0; i < 10 && second.running; i++) await tick();
            expect(second.running).toBe(false);
        });
    });

    describe('starting again', () => {
        it('a new start replaces the running one, which does not send anything after that', async () => {
            let answer: (v: 'ok') => void = () => { };
            send.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve as any; }));
            const stream = new GameStream(deps);
            stream.start(CFG);
            await flush();
            stream.start({ ...CFG, url: 'http://1.2.3.4:30120/monitor/stream/tok_second_abcdefghijk' });
            await flush();
            answer('ok');
            await flush();
            const urls = send.mock.calls.map((c) => c[0]);
            expect(urls).toEqual([CFG.url, 'http://1.2.3.4:30120/monitor/stream/tok_second_abcdefghijk']);
            expect(stream.running).toBe(true);
        });
    });

    describe('settings', () => {
        it.each([
            [{ fps: 500 }, 20],
            [{ fps: 0 }, 5],
            [{ fps: NaN }, 12],
        ])('keeps fps inside 5 to 20 (%j gives %i)', async (patch, expectedFps) => {
            const stream = new GameStream(deps);
            stream.start({ ...CFG, ...patch } as StreamStart);
            await flush();
            const frameMs = Math.round(1000 / expectedFps);
            expect(sleeps[0].ms).toBe(Math.max(0, frameMs - 50));
        });

        it('passes width and quality inside their bounds', async () => {
            const stream = new GameStream(deps);
            stream.start({ ...CFG, width: 99999, quality: 9 });
            await flush();
            expect(capture).toHaveBeenCalledWith(1280, 0.8);
        });
    });
});
