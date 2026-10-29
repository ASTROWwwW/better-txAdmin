//@ts-nocheck
import { suite, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@lib/console', () => {
    const noop = () => { };
    const verbose = { warn: noop, error: noop, log: noop, debug: noop, dir: noop };
    const c = { warn: noop, error: noop, log: noop, debug: noop, dir: noop, verbose, defer: () => c };
    return { default: () => c };
});
import handleFd3Messages from './handleFd3Messages';

const trace = (payload: unknown, resource = 'monitor') => ({
    key: 1,
    value: {
        channel: 'citizen-server-impl',
        data: { type: 'script_structured_trace', resource, payload },
        file: '', func: '', line: 0,
    },
});

suite('handleFd3Messages player positions', () => {
    let handleReport: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        handleReport = vi.fn();
        vi.stubGlobal('txCore', {
            fxRunner: { child: { mutex: 'm1' } },
            fxPlayerPositions: { handleReport },
        });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('hands a monitor resource report to the positions module', () => {
        const payload = { type: 'txAdminPlayerPositions', players: [[1, 2, 3, 0]] };
        handleFd3Messages('m1', trace(payload));
        expect(handleReport).toHaveBeenCalledWith(payload);
    });

    it('ignores the same report printed by any other resource', () => {
        handleFd3Messages('m1', trace({ type: 'txAdminPlayerPositions', players: [] }, 'some-cheat-resource'));
        expect(handleReport).not.toHaveBeenCalled();
    });

    it('ignores a report from a previous server run', () => {
        handleFd3Messages('old-mutex', trace({ type: 'txAdminPlayerPositions', players: [] }));
        expect(handleReport).not.toHaveBeenCalled();
    });

    it('does not take a malformed trace down', () => {
        expect(() => handleFd3Messages('m1', { value: {} })).not.toThrow();
        expect(handleReport).not.toHaveBeenCalled();
    });
});
