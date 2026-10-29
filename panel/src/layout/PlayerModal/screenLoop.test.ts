import { suite, it, expect } from 'vitest';
import { FRAME_PERIOD_MS, MAX_CONSECUTIVE_FAILURES, getNextStep } from './screenLoop';

const frame = { image: 'data:image/jpeg;base64,AAAA', ts: 1 };
const error = (code: string) => ({ error: 'message', code });

suite('getNextStep', () => {
    it('shows the frame and starts the next one a period after the last started', () => {
        expect(getNextStep(frame, 400, 0)).toEqual({ kind: 'frame', waitMs: FRAME_PERIOD_MS - 400 });
    });

    it('does not wait at all when the capture was slower than the period', () => {
        expect(getNextStep(frame, FRAME_PERIOD_MS + 900, 3)).toEqual({ kind: 'frame', waitMs: 0 });
    });

    it('never asks again before the one second the core enforces', () => {
        expect(FRAME_PERIOD_MS).toBeGreaterThanOrEqual(1100);
    });

    it.each(['busy', 'too_fast', 'too_many', 'timeout', 'capture_failed'])('retries after %s a few times', (code) => {
        expect(getNextStep(error(code), 100, 0)).toMatchObject({ kind: 'retry', failures: 1 });
        expect(getNextStep(error(code), 100, MAX_CONSECUTIVE_FAILURES - 2)).toMatchObject({ kind: 'retry', failures: MAX_CONSECUTIVE_FAILURES - 1 });
    });

    it('gives up once the failures in a row reach the limit, with the server message', () => {
        const step = getNextStep(error('timeout'), 100, MAX_CONSECUTIVE_FAILURES - 1);
        expect(step).toEqual({ kind: 'stop', message: 'message', code: 'timeout' });
    });

    it('offers to renew a session that reached its time limit', () => {
        expect(getNextStep(error('session_expired'), 100, 0)).toEqual({ kind: 'expired', message: 'message' });
    });

    it.each(['player_gone', 'server_offline', 'server_closed', 'screenshot_basic_missing', 'no_permission', 'invalid_image', 'unknown', 'something_new'])(
        'stops at once on %s',
        (code) => {
            expect(getNextStep(error(code), 100, 0)).toEqual({ kind: 'stop', message: 'message', code });
        },
    );

    it('stops on a response it does not understand', () => {
        expect(getNextStep({} as any, 100, 0)).toMatchObject({ kind: 'stop' });
        expect(getNextStep(undefined as any, 100, 0)).toMatchObject({ kind: 'stop' });
    });

    it('does not take a response whose image is not an image data uri', () => {
        expect(getNextStep({ image: 'https://evil.example/x.png', ts: 1 }, 100, 0)).toMatchObject({ kind: 'stop' });
        expect(getNextStep({ image: 'data:text/html;base64,AAAA', ts: 1 }, 100, 0)).toMatchObject({ kind: 'stop' });
    });
});
