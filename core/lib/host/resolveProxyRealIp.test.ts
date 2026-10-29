import { suite, it, expect, vi, beforeEach } from 'vitest';
import { parseIpRanges } from './isIpInRanges';

const hostConfig = vi.hoisted(() => ({ proxyIpRanges: undefined as any }));
vi.mock('@core/globalData', () => ({ txHostConfig: hostConfig }));

import { resolveProxyRealIp } from './resolveProxyRealIp';


suite('resolveProxyRealIp', () => {
    beforeEach(() => {
        hostConfig.proxyIpRanges = parseIpRanges(['10.0.0.0/8']);
    });

    it('ignores the header when proxy support is not configured', () => {
        hostConfig.proxyIpRanges = undefined;
        expect(resolveProxyRealIp('10.0.0.1', '203.0.113.9')).toBeUndefined();
    });

    it('ignores the header when the socket is not a trusted proxy', () => {
        expect(resolveProxyRealIp('198.51.100.7', '127.0.0.1')).toBeUndefined();
    });

    it('returns the client appended by the trusted proxy', () => {
        expect(resolveProxyRealIp('10.0.0.1', '203.0.113.9')).toBe('203.0.113.9');
    });

    it('is not fooled by a spoofed leftmost entry', () => {
        expect(resolveProxyRealIp('10.0.0.1', '127.0.0.1, 203.0.113.9')).toBe('203.0.113.9');
        expect(resolveProxyRealIp('10.0.0.1', '10.9.9.9, 203.0.113.9')).toBe('203.0.113.9');
    });

    it('skips other trusted proxies in the chain', () => {
        expect(resolveProxyRealIp('10.0.0.1', '203.0.113.9, 10.0.0.2')).toBe('203.0.113.9');
    });

    it('falls back to the leftmost entry when the whole chain is trusted', () => {
        expect(resolveProxyRealIp('10.0.0.1', '10.0.0.5, 10.0.0.2')).toBe('10.0.0.5');
    });

    it('ignores malformed entries and a missing header', () => {
        expect(resolveProxyRealIp('10.0.0.1', undefined)).toBeUndefined();
        expect(resolveProxyRealIp('10.0.0.1', 'not-an-ip')).toBeUndefined();
    });
});
