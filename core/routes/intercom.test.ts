//@ts-nocheck
import { suite, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@core/globalData', () => ({ txEnv: { txaVersion: '9.9.9' }, txHostConfig: {}, txDevEnv: {} }));
vi.mock('@lib/console', () => {
    const noop = () => { };
    const verbose = { warn: noop, error: noop, log: noop, debug: noop, dir: noop };
    return { default: () => ({ warn: noop, error: noop, log: noop, debug: noop, verbose }) };
});
import Intercom from './intercom';

suite('intercom screenshot scope', () => {
    let handleResult: ReturnType<typeof vi.fn>;
    const ctx = (scope: string, body: any) => ({
        params: { scope },
        request: { body },
        send: vi.fn(),
        utils: { error: vi.fn() },
    });

    beforeEach(() => {
        handleResult = vi.fn();
        vi.stubGlobal('txCore', { fxScreenshots: { handleResult } });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('hands the answer of the server to the screenshot manager, without the token', async () => {
        const c = ctx('screenshot', { txAdminToken: 'secret-token', reqId: 'abc', image: 'data:image/jpeg;base64,AAAA' });
        await Intercom(c);
        expect(handleResult).toHaveBeenCalledTimes(1);
        const payload = handleResult.mock.calls[0][0];
        expect(payload).toMatchObject({ reqId: 'abc', image: 'data:image/jpeg;base64,AAAA' });
        expect(payload.txAdminToken).not.toBe('secret-token');
        expect(c.send).toHaveBeenCalledWith({ success: true });
    });

    it('still refuses an unknown scope', async () => {
        const c = ctx('nope', { txAdminToken: 'x' });
        await Intercom(c);
        expect(handleResult).not.toHaveBeenCalled();
        expect(c.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'danger' }));
    });
});
