//@ts-nocheck
import { suite, it, expect, vi, beforeEach, afterEach } from 'vitest';

import AdminStore from './index.js';

const buildStore = () => {
    const store = Object.create(AdminStore.prototype);
    store.admins = [
        { name: 'bob', master: false, password_hash: 'old-hash', providers: {}, permissions: ['console.view'] },
        { name: 'Alice', master: false, password_hash: 'alice-hash', providers: {}, permissions: [] },
    ];
    store.writeAdminsFile = vi.fn(async () => { });
    store.refreshOnlineAdmins = vi.fn(async () => { });
    return store;
};

suite('AdminStore.editAdmin', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('changing the password does not rename the admin', async () => {
        const store = buildStore();
        const result = await store.editAdmin('bob', 'a-new-password');
        expect(store.admins[0].name).toBe('bob');
        expect(store.admins[0].password_hash).not.toBe('old-hash');
        expect(result).toBe(store.admins[0].password_hash);
    });

    it('changing the identifiers keeps the password hash', async () => {
        const store = buildStore();
        await store.editAdmin('bob', null, { id: '1', identifier: 'fivem:1' }, false);
        expect(store.admins[0].password_hash).toBe('old-hash');
        expect(store.admins[0].providers.citizenfx.identifier).toBe('fivem:1');
        expect(store.admins[0].name).toBe('bob');
    });

    it('renames an admin without touching the password', async () => {
        const store = buildStore();
        await store.editAdmin('bob', null, undefined, undefined, undefined, 'bobby');
        expect(store.admins[0].name).toBe('bobby');
        expect(store.admins[0].password_hash).toBe('old-hash');
        expect(store.writeAdminsFile).toHaveBeenCalledTimes(1);
    });

    it('allows changing only the casing of the own name', async () => {
        const store = buildStore();
        await store.editAdmin('bob', null, undefined, undefined, undefined, 'Bob');
        expect(store.admins[0].name).toBe('Bob');
    });

    it('refuses a name already used by another admin, whatever the casing', async () => {
        const store = buildStore();
        await expect(store.editAdmin('bob', null, undefined, undefined, undefined, 'ALICE')).rejects.toThrow('already taken');
        expect(store.admins[0].name).toBe('bob');
        expect(store.writeAdminsFile).not.toHaveBeenCalled();
    });
});
