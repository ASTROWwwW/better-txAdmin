import { suite, it, expect } from 'vitest';
import { isIpAddressLocal, addLocalIpAddress, formatHostPort } from './isIpAddressLocal';


suite('isIpAddressLocal', () => {
    it('accepts loopback and lan ipv4 addresses', () => {
        for (const ip of ['127.0.0.1', '192.168.1.5', '10.20.30.40']) {
            expect(isIpAddressLocal(ip), ip).toBe(true);
        }
    });

    it('accepts ipv6 loopback', () => {
        expect(isIpAddressLocal('::1')).toBe(true);
    });

    it('reads ipv4-mapped addresses, as reported by a dual stack socket', () => {
        for (const ip of ['::ffff:127.0.0.1', '::ffff:192.168.1.5', '::ffff:10.20.30.40']) {
            expect(isIpAddressLocal(ip), ip).toBe(true);
        }
    });

    it('rejects public addresses, mapped or not', () => {
        for (const ip of ['8.8.8.8', '::ffff:8.8.8.8', '2001:db8::1', '100.64.0.1']) {
            expect(isIpAddressLocal(ip), ip).toBe(false);
        }
    });

    it('accepts the extra addresses registered at runtime', () => {
        expect(isIpAddressLocal('203.0.113.77')).toBe(false);
        addLocalIpAddress('203.0.113.77');
        expect(isIpAddressLocal('203.0.113.77')).toBe(true);
    });
});

suite('formatHostPort', () => {
    it('keeps ipv4 addresses and hostnames as host:port', () => {
        expect(formatHostPort('1.2.3.4', 30120)).toBe('1.2.3.4:30120');
        expect(formatHostPort('localhost', '40120')).toBe('localhost:40120');
    });

    it('wraps ipv6 addresses in brackets', () => {
        expect(formatHostPort('::1', 40120)).toBe('[::1]:40120');
        expect(formatHostPort('::', 30120)).toBe('[::]:30120');
        expect(formatHostPort('fe80::1', 80)).toBe('[fe80::1]:80');
    });
});
