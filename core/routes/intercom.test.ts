//@ts-nocheck
import { suite, it, describe, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@core/globalData', () => ({ txEnv: { txaVersion: '9.9.9' }, txHostConfig: {}, txDevEnv: {} }));
vi.mock('@lib/console', () => {
    const noop = () => { };
    const verbose = { warn: noop, error: noop, log: noop, debug: noop, dir: noop };
    return { default: () => ({ warn: noop, error: noop, log: noop, debug: noop, verbose }) };
});
import Intercom from './intercom';

suite('intercom screenshot scope', () => {
    let handleResult: ReturnType<typeof vi.fn>;
    let handleFrame: ReturnType<typeof vi.fn>;
    const ctx = (scope: string, body: any) => ({
        params: { scope },
        request: { body },
        send: vi.fn(),
        utils: { error: vi.fn() },
    });

    beforeEach(() => {
        handleResult = vi.fn();
        handleFrame = vi.fn().mockReturnValue({ ok: true });
        vi.stubGlobal('txCore', { fxScreenshots: { handleResult }, fxScreenStreams: { handleFrame } });
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

    describe('screenstream scope', () => {
        it('hands the frame to the stream manager and relays its answer (ok or stop) to the server resource', async () => {
            const c = ctx('screenstream', { txAdminToken: 'secret-token', sessionId: 's1', frame: '/9j/AAAA' });
            await Intercom(c);
            expect(handleFrame).toHaveBeenCalledWith('s1', '/9j/AAAA');
            expect(c.send).toHaveBeenCalledWith({ ok: true });

            handleFrame.mockReturnValue({ stop: true });
            const c2 = ctx('screenstream', { txAdminToken: 'secret-token', sessionId: 's1', frame: '/9j/AAAA' });
            await Intercom(c2);
            expect(c2.send).toHaveBeenCalledWith({ stop: true });
        });

        it('stops the sender when the body is not what the server resource sends', async () => {
            for (const body of [{ txAdminToken: 'x' }, { txAdminToken: 'x', sessionId: 12, frame: 'a' }, { txAdminToken: 'x', sessionId: 's1', frame: { a: 1 } }]) {
                const c = ctx('screenstream', body);
                await Intercom(c);
                expect(c.send).toHaveBeenCalledWith({ stop: true });
            }
            expect(handleFrame).not.toHaveBeenCalled();
        });
    });

    it('still refuses an unknown scope', async () => {
        const c = ctx('nope', { txAdminToken: 'x' });
        await Intercom(c);
        expect(handleResult).not.toHaveBeenCalled();
        expect(c.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'danger' }));
    });
});
