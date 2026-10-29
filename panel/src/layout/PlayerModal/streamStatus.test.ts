import { suite, it, describe, expect } from 'vitest';
import {
    buildStreamImageUrl,
    getStreamStep,
    MAX_STATUS_FAILURES,
    STREAM_PRESETS,
    DEFAULT_PRESET,
    END_REASONS,
} from './streamStatus';

const live = { state: 'live' as const, frames: 40, fps: 11.8, bytes: 1000, ageMs: 4000 };

suite('getStreamStep', () => {
    describe('while it runs', () => {
        it('waits for the first frame', () => {
            expect(getStreamStep({ ...live, state: 'waiting', frames: 0, fps: 0 }, 0)).toEqual({ kind: 'waiting' });
        });

        it('reports the live fps and frame count', () => {
            expect(getStreamStep(live, 0)).toEqual({ kind: 'live', fps: 11.8, frames: 40 });
        });

        it('resets the failure count on an answer', () => {
            expect(getStreamStep(live, 3)).toMatchObject({ kind: 'live' });
        });
    });

    describe('when asking fails', () => {
        it('tries again a few times when txAdmin cannot be reached', () => {
            expect(getStreamStep(undefined, 0)).toEqual({ kind: 'retry', failures: 1 });
            expect(getStreamStep(undefined, MAX_STATUS_FAILURES - 2)).toEqual({ kind: 'retry', failures: MAX_STATUS_FAILURES - 1 });
        });

        it('says the contact is lost after the limit', () => {
            const step = getStreamStep(undefined, MAX_STATUS_FAILURES - 1);
            expect(step).toMatchObject({ kind: 'ended', reason: 'lost', canRestart: true, fallback: false });
        });

        it('says the view is gone when txAdmin does not know it', () => {
            expect(getStreamStep({ error: 'x', code: 'not_found' }, 0)).toMatchObject({ kind: 'ended', reason: 'not_found', canRestart: true });
        });

        it('says no permission without offering to restart', () => {
            expect(getStreamStep({ error: 'x', code: 'no_permission' }, 0)).toMatchObject({ kind: 'ended', reason: 'no_permission', canRestart: false });
        });

        it('treats an unknown error code as a stop with the generic message', () => {
            expect(getStreamStep({ error: 'secret detail', code: 'weird' }, 0)).toMatchObject({ kind: 'ended', reason: 'unknown' });
        });

        it.each([null, 5, 'text', {}, { state: 'weird' }, []])('stops on an answer it does not understand (%j)', (value) => {
            expect(getStreamStep(value as any, 0)).toMatchObject({ kind: 'ended', reason: 'unknown' });
        });
    });

    describe('why it ended', () => {
        const ended = (reason?: string) => getStreamStep({ ...live, state: 'ended', reason } as any, 0) as any;

        it('falls back to screenshots when the player game never sent a frame', () => {
            expect(ended('failed_to_start')).toMatchObject({ kind: 'ended', reason: 'failed_to_start', fallback: true });
        });

        it.each([
            ['time_limit', true],
            ['stalled', true],
            ['no_viewer', true],
            ['replaced', true],
            ['server_closed', true],
            ['revoked', false],
            ['closed', true],
        ])('%s: restart offered = %s, no fallback', (reason, canRestart) => {
            const step = ended(reason);
            expect(step).toMatchObject({ kind: 'ended', reason, canRestart, fallback: false });
            expect(typeof step.message).toBe('string');
            expect(step.message.length).toBeGreaterThan(5);
        });

        it('has a message for every reason the core can give', () => {
            for (const reason of ['closed', 'replaced', 'no_viewer', 'time_limit', 'failed_to_start', 'stalled', 'revoked', 'server_closed']) {
                expect(END_REASONS[reason as keyof typeof END_REASONS], reason).toBeDefined();
            }
        });

        it('uses the generic message for a reason it does not know', () => {
            expect(ended('brand_new')).toMatchObject({ kind: 'ended', reason: 'unknown', canRestart: true });
        });

        it('mentions the 10 minutes for the time limit', () => {
            expect(ended('time_limit').message).toContain('10 minutes');
        });
    });
});

suite('presets', () => {
    it('stay inside what the core and the game accept', () => {
        for (const preset of Object.values(STREAM_PRESETS)) {
            expect(preset.fps).toBeGreaterThanOrEqual(5);
            expect(preset.fps).toBeLessThanOrEqual(20);
            expect(preset.width).toBeGreaterThanOrEqual(320);
            expect(preset.width).toBeLessThanOrEqual(1280);
            expect(preset.quality).toBeGreaterThanOrEqual(0.2);
            expect(preset.quality).toBeLessThanOrEqual(0.8);
        }
    });

    it('has a default preset that exists', () => {
        expect(STREAM_PRESETS[DEFAULT_PRESET]).toBeDefined();
    });
});

suite('buildStreamImageUrl', () => {
    it('builds the path with the view token', () => {
        expect(buildStreamImageUrl('sess_1-A', 'tok_2-B')).toBe('/player/screenStream/sess_1-A?t=tok_2-B');
    });

    it('encodes anything unexpected so it cannot add parameters or change the path', () => {
        const url = buildStreamImageUrl('a/../b?x=1', 'a&t=2#frag');
        const afterPrefix = url.slice('/player/screenStream/'.length);
        expect(afterPrefix.split('?')[0]).not.toContain('/'); //one path segment, so '..' is not a segment
        expect(url.match(/\?/g)).toHaveLength(1);
        expect(url).not.toContain('&');
        expect(url).not.toContain('#');
        expect(url.startsWith('/player/screenStream/')).toBe(true);
    });
});
