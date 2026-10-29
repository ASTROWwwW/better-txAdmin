import type { ApiPlayerScreenStreamStatusResp } from '@shared/playerApiTypes';

export const MAX_STATUS_FAILURES = 5;
export const STATUS_PERIOD_MS = 1000;

export const STREAM_PRESETS = {
    light: { label: 'Light (8 fps, 480 px)', fps: 8, width: 480, quality: 0.5 },
    normal: { label: 'Smooth (12 fps, 640 px)', fps: 12, width: 640, quality: 0.5 },
    high: { label: 'Sharp (20 fps, 960 px)', fps: 20, width: 960, quality: 0.6 },
} as const;
export type StreamPresetKey = keyof typeof STREAM_PRESETS;
export const DEFAULT_PRESET: StreamPresetKey = 'normal';

type EndInfo = { message: string; canRestart: boolean; fallback: boolean };

/**
 * Why a view ended, as the core names it, and what the viewer does about it.
 * `fallback`: the player's game could not stream, use the screenshots instead.
 */
export const END_REASONS = {
    closed: { message: 'The live view was closed.', canRestart: true, fallback: false },
    replaced: { message: 'A newer live view of this player replaced this one.', canRestart: true, fallback: false },
    no_viewer: { message: 'The image was disconnected for too long, so the live view stopped.', canRestart: true, fallback: false },
    time_limit: { message: 'The live view ends after 10 minutes. Start it again to keep watching.', canRestart: true, fallback: false },
    failed_to_start: { message: 'The player\'s game did not send any image, switching to screenshots.', canRestart: false, fallback: true },
    stalled: { message: 'The player stopped sending images (they left, closed the game, or it froze).', canRestart: true, fallback: false },
    revoked: { message: 'You do not have the permission to see this anymore.', canRestart: false, fallback: false },
    server_closed: { message: 'The server was stopped.', canRestart: true, fallback: false },
    lost: { message: 'Lost contact with txAdmin.', canRestart: true, fallback: false },
    not_found: { message: 'This live view does not exist anymore.', canRestart: true, fallback: false },
    no_permission: { message: 'You don\'t have permission to execute this action.', canRestart: false, fallback: false },
    unknown: { message: 'The live view stopped unexpectedly.', canRestart: true, fallback: false },
} as const satisfies Record<string, EndInfo>;
export type EndReason = keyof typeof END_REASONS;

export type StreamStep =
    | { kind: 'waiting' }
    | { kind: 'live'; fps: number; frames: number }
    | { kind: 'retry'; failures: number }
    | ({ kind: 'ended'; reason: EndReason } & EndInfo);

const ended = (reason: EndReason): StreamStep => ({ kind: 'ended', reason, ...END_REASONS[reason] });

/**
 * What the viewer does with an answer of the status route: keep showing, ask again after a hiccup,
 * or stop and say why. `failures` counts the unanswered asks in a row.
 */
export const getStreamStep = (resp: ApiPlayerScreenStreamStatusResp | undefined, failures: number): StreamStep => {
    if (resp === undefined) {
        return failures + 1 < MAX_STATUS_FAILURES ? { kind: 'retry', failures: failures + 1 } : ended('lost');
    }
    if (!resp || typeof resp !== 'object') return ended('unknown');

    if ('error' in resp) {
        if (resp.code === 'not_found') return ended('not_found');
        if (resp.code === 'no_permission') return ended('no_permission');
        return ended('unknown');
    }
    if (resp.state === 'waiting') return { kind: 'waiting' };
    if (resp.state === 'live') return { kind: 'live', fps: resp.fps, frames: resp.frames };
    if (resp.state === 'ended') {
        const reason = resp.reason && Object.hasOwn(END_REASONS, resp.reason) ? resp.reason as EndReason : 'unknown';
        return ended(reason);
    }
    return ended('unknown');
};

/**
 * The address of the image. Nothing in it is trusted to be safe to put in a url.
 */
export const buildStreamImageUrl = (sessionId: string, viewToken: string) => {
    return `/player/screenStream/${encodeURIComponent(sessionId)}?t=${encodeURIComponent(viewToken)}`;
};
