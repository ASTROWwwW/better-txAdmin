import { suite, it, expect, afterEach, vi } from 'vitest';
import { getHostVars } from './getHostVars';

suite('getHostVars DISABLE_TTY_TITLE', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('is undefined when the variable is not set', () => {
        expect(getHostVars().DISABLE_TTY_TITLE).toBeUndefined();
    });

    it('is true only for the string "true"', () => {
        vi.stubEnv('TXHOST_DISABLE_TTY_TITLE', 'true');
        expect(getHostVars().DISABLE_TTY_TITLE).toBe(true);
        vi.stubEnv('TXHOST_DISABLE_TTY_TITLE', 'false');
        expect(getHostVars().DISABLE_TTY_TITLE).toBe(false);
        vi.stubEnv('TXHOST_DISABLE_TTY_TITLE', '1');
        expect(getHostVars().DISABLE_TTY_TITLE).toBe(false);
    });
});


suite('getHostVars INTERFACE', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('accepts ipv4 and ipv6 addresses', () => {
        vi.stubEnv('TXHOST_INTERFACE', '192.168.1.10');
        expect(getHostVars().INTERFACE).toBe('192.168.1.10');
        vi.stubEnv('TXHOST_INTERFACE', '::1');
        expect(getHostVars().INTERFACE).toBe('::1');
    });
});
