import type { ApiPlayerScreenshotResp } from '@shared/playerApiTypes';

export const FRAME_PERIOD_MS = 1500; //between the start of two captures, the core refuses anything faster than 1s
export const MAX_CONSECUTIVE_FAILURES = 5;

const RETRY_CODES = ['busy', 'too_fast', 'too_many', 'timeout', 'capture_failed'];
const IMAGE_REGEX = /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;

export type ScreenStep =
    | { kind: 'frame'; waitMs: number }
    | { kind: 'retry'; waitMs: number; failures: number }
    | { kind: 'expired'; message: string }
    | { kind: 'stop'; message: string; code: string };

/**
 * What the viewer does after an answer of the core: show the frame and go on, try again after a
 * hiccup, offer to renew a session that ran out of time, or stop and say why.
 * The image is checked again here, as it ends up in an <img src>.
 */
export const getNextStep = (resp: ApiPlayerScreenshotResp | undefined, elapsedMs: number, failures: number): ScreenStep => {
    if (resp && 'image' in resp) {
        if (typeof resp.image !== 'string' || !IMAGE_REGEX.test(resp.image)) {
            return { kind: 'stop', message: 'The server sent something that is not an image.', code: 'invalid_image' };
        }
        return { kind: 'frame', waitMs: Math.max(0, FRAME_PERIOD_MS - elapsedMs) };
    }
    if (!resp || !('error' in resp)) {
        return { kind: 'stop', message: 'Unexpected answer from txAdmin.', code: 'unknown' };
    }
    if (resp.code === 'session_expired') return { kind: 'expired', message: resp.error };
    if (RETRY_CODES.includes(resp.code) && failures + 1 < MAX_CONSECUTIVE_FAILURES) {
        return { kind: 'retry', waitMs: FRAME_PERIOD_MS, failures: failures + 1 };
    }
    return { kind: 'stop', message: resp.error, code: resp.code };
};
