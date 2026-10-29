import type { SendResult } from './streamLoop';

const TIMEOUT_MS = 5000;

/**
 * Sends one frame (base64 text, so the request needs no CORS preflight) and reads the answer of the server:
 * {"ok":true} to go on, {"stop":true} to end.
 */
export const sendFrame = async (url: string, frame: string): Promise<SendResult> => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            method: 'POST',
            mode: 'cors',
            cache: 'no-store',
            headers: { 'Content-Type': 'text/plain' },
            body: frame,
            signal: abort.signal,
        });
        const answer = await response.json();
        if (answer?.stop === true) return 'stop';
        return response.ok && answer?.ok === true ? 'ok' : 'error';
    } catch {
        return 'error';
    } finally {
        clearTimeout(timer);
    }
};
