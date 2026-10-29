import { suite, it, expect, vi, beforeEach } from 'vitest';
import { parseIpRanges } from './isIpInRanges';

const hostConfig = vi.hoisted(() => ({ proxyIpRanges: undefined as any }));
vi.mock('@core/globalData', () => ({ txHostConfig: hostConfig }));

import { resolveProxyRealIp, UNRESOLVED_CLIENT_IP } from './resolveProxyRealIp';


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

    it('reads an ipv6 client appended by the proxy instead of falling back to a forged entry', () => {
        expect(resolveProxyRealIp('10.0.0.1', '10.9.9.9, 2001:db8::1')).toBe('2001:db8::1');
        expect(resolveProxyRealIp('10.0.0.1', '2001:db8::1')).toBe('2001:db8::1');
    });

    it('reads clients appended as ip:port or [ipv6]:port', () => {
        expect(resolveProxyRealIp('10.0.0.1', '10.9.9.9, 203.0.113.9:51234')).toBe('203.0.113.9');
        expect(resolveProxyRealIp('10.0.0.1', '10.9.9.9, [2001:db8::1]:443')).toBe('2001:db8::1');
    });

    it('reads an ipv4-mapped client as its ipv4', () => {
        expect(resolveProxyRealIp('10.0.0.1', '10.9.9.9, ::ffff:203.0.113.9')).toBe('203.0.113.9');
    });

    it('fails closed when the client entry cannot be read, never trusting an entry on its left', () => {
        for (const header of ['10.9.9.9, unknown', '10.9.9.9, ', '203.0.113.9,', '10.9.9.9, not-an-ip', ',']) {
            expect(resolveProxyRealIp('10.0.0.1', header), header).toBe(`${UNRESOLVED_CLIENT_IP}:10.0.0.1`);
        }
    });

    it('keeps unreadable clients of different proxies in different rate limit buckets', () => {
        const a = resolveProxyRealIp('10.0.0.1', '10.9.9.9, unknown');
        const b = resolveProxyRealIp('10.0.0.2', '10.9.9.9, unknown');
        expect(a).not.toBe(b);
    });

    it('does not read zone ids, they are not what a proxy appends', () => {
        for (const header of ['10.9.9.9, fe80::1%eth0', '10.9.9.9, ::1%eth0', '10.9.9.9, ::ffff:127.0.0.1%eth0']) {
            expect(resolveProxyRealIp('10.0.0.1', header), header).toBe(`${UNRESOLVED_CLIENT_IP}:10.0.0.1`);
        }
    });

    it('reads every ipv4-mapped notation as the ipv4 it stands for', () => {
        expect(resolveProxyRealIp('10.0.0.1', '10.9.9.9, ::ffff:7f00:1')).toBe('127.0.0.1');
        expect(resolveProxyRealIp('10.0.0.1', '10.9.9.9, 0:0:0:0:0:ffff:203.0.113.9')).toBe('203.0.113.9');
        expect(resolveProxyRealIp('10.0.0.1', '10.9.9.9, ::FfFf:cb00:7109')).toBe('203.0.113.9');
    });

    it('skips a trusted proxy written in a mapped notation', () => {
        expect(resolveProxyRealIp('10.0.0.1', '203.0.113.9, ::ffff:a00:5')).toBe('203.0.113.9');
    });

    it('returns the leftmost entry when every hop is a trusted proxy', () => {
        expect(resolveProxyRealIp('10.0.0.1', '10.1.1.1, 10.2.2.2')).toBe('10.1.1.1');
    });

    it('ignores malformed entries and a missing header', () => {
        expect(resolveProxyRealIp('10.0.0.1', undefined)).toBeUndefined();
    });
});
