//@ts-nocheck
import { suite, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@core/globalData', () => ({ txEnv: { txaVersion: '9.9.9' }, txHostConfig: {}, txDevEnv: {} }));
vi.mock('@lib/console', () => ({
    default: () => ({ warn: vi.fn(), error: vi.fn(), log: vi.fn(), verbose: { warn: vi.fn(), error: vi.fn(), log: vi.fn() } }),
}));
import AdminManagerActions from './actions';

suite('AdminManagerActions edit (rename)', () => {
    let ctx: any;
    let editAdmin: ReturnType<typeof vi.fn>;
    const edit = (body: Record<string, unknown>) => {
        ctx.request.body = { citizenfxID: '', discordID: '', permissions: [], ...body };
        return AdminManagerActions(ctx);
    };

    beforeEach(() => {
        editAdmin = vi.fn().mockResolvedValue(undefined);
        const target = { name: 'Bob', master: false, permissions: [], providers: {} };
        vi.stubGlobal('txCore', {
            adminStore: {
                getAdminByName: (name: string) => (name.toLowerCase() === 'bob' ? target : undefined),
                editAdmin,
            },
        });
        ctx = {
            params: { action: 'edit' },
            admin: { name: 'root', isMaster: true, permissions: ['all_permissions'], testPermission: () => true, logAction: vi.fn() },
            request: { body: {} },
            send: vi.fn(),
            utils: { error: vi.fn() },
        };
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('renames the admin to a different name', async () => {
        await edit({ originalName: 'Bob', name: 'Robert' });
        expect(editAdmin).toHaveBeenCalledWith('Bob', null, false, false, [], 'Robert');
        expect(ctx.send).toHaveBeenCalledWith({ type: 'success', refresh: true });
    });

    it('applies a rename that only changes the capitalization', async () => {
        await edit({ originalName: 'bob', name: 'Bob' });
        expect(editAdmin).toHaveBeenCalledWith('bob', null, false, false, [], 'Bob');
    });

    it('does not rename when the name is untouched', async () => {
        await edit({ originalName: 'Bob', name: 'Bob' });
        expect(editAdmin).toHaveBeenCalledWith('Bob', null, false, false, [], undefined);
    });

    it('refuses an invalid new username', async () => {
        await edit({ originalName: 'Bob', name: 'not valid!' });
        expect(editAdmin).not.toHaveBeenCalled();
        expect(ctx.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'danger' }));
    });
});
