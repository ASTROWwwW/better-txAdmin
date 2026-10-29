import { suite, it, expect } from 'vitest';
import { getScreenTarget } from './screenTarget';

suite('getScreenTarget', () => {
    it('uses the mutex and netid of a modal opened from the playerlist', () => {
        expect(getScreenTarget({ mutex: 'm1abc', netid: 7 }, { netid: 7, isConnected: true })).toEqual({ mutex: 'm1abc', netid: 7 });
    });

    it('works for a modal opened by license (players page, history) when the player is online now', () => {
        expect(getScreenTarget({ license: 'abc' }, { netid: 12, isConnected: true })).toEqual({ mutex: 'current', netid: 12 });
    });

    it('has no target for a player who is offline, or for a modal that did not load yet', () => {
        expect(getScreenTarget({ license: 'abc' }, { netid: undefined, isConnected: false })).toBeUndefined();
        expect(getScreenTarget({ license: 'abc' }, { netid: 12, isConnected: false })).toBeUndefined();
        expect(getScreenTarget({ license: 'abc' }, undefined)).toBeUndefined();
        expect(getScreenTarget({ mutex: 'm1abc', netid: 7 }, undefined)).toEqual({ mutex: 'm1abc', netid: 7 });
    });

    it('has no target without a netid', () => {
        expect(getScreenTarget({ license: 'abc' }, { netid: undefined, isConnected: true })).toBeUndefined();
        expect(getScreenTarget({ license: 'abc' }, { netid: 0, isConnected: true })).toBeUndefined();
    });
});
