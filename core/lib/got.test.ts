import { suite, it, expect, vi, beforeEach } from 'vitest';

const loadGot = async (netInterface: string | undefined) => {
    vi.resetModules();
    vi.doMock('@core/globalData', () => ({
        txEnv: { txaVersion: '9.9.9' },
        txHostConfig: { netInterface },
    }));
    return (await import('./got')).default;
};

suite('got client', () => {
    beforeEach(() => {
        vi.doUnmock('@core/globalData');
    });

    it('binds outgoing requests to a forced ipv4 interface', async () => {
        const got = await loadGot('10.0.0.5');
        expect(got.defaults.options.localAddress).toBe('10.0.0.5');
    });

    it('does not bind to an ipv6 interface, it would break every request to an ipv4 host', async () => {
        const got = await loadGot('2001:db8::10');
        expect(got.defaults.options.localAddress).toBeUndefined();
    });

    it('does not bind when no interface is forced', async () => {
        const got = await loadGot(undefined);
        expect(got.defaults.options.localAddress).toBeUndefined();
    });
});
