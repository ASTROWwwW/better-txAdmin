//@ts-nocheck
import { suite, it, expect } from 'vitest';
import AdminStore from './index.js';

const buildStore = () => {
    const store = Object.create(AdminStore.prototype);
    store.addMasterPin = '4821';
    return store;
};

suite('AdminStore.checkAddMasterPin', () => {
    it('accepts the right PIN and refuses anything else', () => {
        const store = buildStore();
        expect(store.checkAddMasterPin('0000')).toBe('wrong');
        expect(store.checkAddMasterPin('')).toBe('wrong');
        expect(store.checkAddMasterPin(4821)).toBe('wrong');
        expect(store.checkAddMasterPin('4821')).toBe('ok');
    });

    it('disables the PIN after ten wrong ones, even for the right PIN', () => {
        const store = buildStore();
        for (let i = 0; i < 9; i++) {
            expect(store.checkAddMasterPin('0000')).toBe('wrong');
        }
        expect(store.checkAddMasterPin('0000')).toBe('locked');
        expect(store.checkAddMasterPin('4821')).toBe('locked');
        expect(store.addMasterPin).toBeUndefined();
    });

    it('is locked when there is no PIN, as when the admins already exist', () => {
        const store = buildStore();
        store.addMasterPin = undefined;
        expect(store.checkAddMasterPin('4821')).toBe('locked');
        expect(store.checkAddMasterPin(undefined)).toBe('locked');
    });
});
