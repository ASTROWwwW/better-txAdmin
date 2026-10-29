import type { StreamStart } from './streamLoop';

//http://<endpoint of the server>/<resource>/stream/<token>, the same shape cl_stream.lua builds
const URL_REGEX = /^http:\/\/[A-Za-z0-9.\-:[\]]{1,120}\/[A-Za-z0-9_-]{1,64}\/stream\/[A-Za-z0-9_-]{16,64}$/;

export type StreamMessage = { type: 'start'; cfg: StreamStart } | { type: 'stop' };

/**
 * Reads a message of the page for the live view. The game sends them without a source window, so a message that
 * comes from another window (the web panel runs in an iframe of this page) is ignored, and so is any address that is
 * not an upload address of this resource: frames of the screen are never sent anywhere else.
 */
export const parseStreamMessage = (
    message: unknown,
    source: unknown,
    ownWindow: unknown,
): StreamMessage | null => {
    if (source && source !== ownWindow) return null;
    if (!message || typeof message !== 'object') return null;
    const { action, data } = message as { action?: unknown; data?: unknown };

    if (action === 'screenStreamStop') return { type: 'stop' };
    if (action !== 'screenStreamStart') return null;
    if (!data || typeof data !== 'object') return null;

    const { url, fps, width, quality, ttlMs } = data as Record<string, unknown>;
    if (typeof url !== 'string' || !URL_REGEX.test(url)) return null;
    if (typeof fps !== 'number' || typeof width !== 'number' || typeof quality !== 'number' || typeof ttlMs !== 'number') {
        return null;
    }
    return { type: 'start', cfg: { url, fps, width, quality, ttlMs } };
};
