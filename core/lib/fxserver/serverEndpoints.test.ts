import { suite, it, expect } from 'vitest';
import { buildServerEndpoints } from './serverEndpoints';

suite('buildServerEndpoints', () => {
    it('listens on all ipv4 interfaces on the default port when nothing is forced', () => {
        expect(buildServerEndpoints({})).toBe(
            'endpoint_add_tcp "0.0.0.0:30120"\nendpoint_add_udp "0.0.0.0:30120"'
        );
    });

    it('uses the forced ipv4 interface and port, with the do-not-modify comment', () => {
        const out = buildServerEndpoints({ netInterface: '10.0.0.5', fxsPort: 30130, sourceName: 'Docker' });
        expect(out).toBe(
            'endpoint_add_tcp "10.0.0.5:30130" # Docker: do not modify!\n'
            + 'endpoint_add_udp "10.0.0.5:30130" # Docker: do not modify!'
        );
    });

    it('brackets a forced ipv6 interface so the port is not read as part of the address', () => {
        const out = buildServerEndpoints({ netInterface: '2001:db8::10', fxsPort: 30120, sourceName: 'Docker' });
        expect(out).toContain('endpoint_add_tcp "[2001:db8::10]:30120"');
        expect(out).toContain('endpoint_add_udp "[2001:db8::10]:30120"');
    });

    it('keeps the default interface when only the port is forced', () => {
        const out = buildServerEndpoints({ fxsPort: 40000, sourceName: 'Host' });
        expect(out).toContain('endpoint_add_tcp "0.0.0.0:40000"');
    });
});
