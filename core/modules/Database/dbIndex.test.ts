import { suite, it, expect } from 'vitest';
import { ActionsIndex, PlayersIndex } from './dbIndex';

const player = (license: string, extra: object = {}) => ({ license, ...extra }) as any;
const action = (id: string, ids: string[], hwids?: string[]) => ({ id, ids, hwids, type: 'ban' }) as any;


suite('PlayersIndex', () => {
    it('finds the player of a license and nothing for an unknown one', () => {
        const players = [player('a'), player('b'), player('c')];
        const index = new PlayersIndex();
        expect(index.find(players, 'b')).toBe(players[1]);
        expect(index.find(players, 'zzz')).toBeUndefined();
    });

    it('returns the first player when the array holds a duplicated license, like find does', () => {
        const players = [player('a', { n: 1 }), player('b'), player('a', { n: 2 })];
        expect(new PlayersIndex().find(players, 'a')).toBe(players[0]);
    });

    it('sees a player added through push without rebuilding', () => {
        const players = [player('a')];
        const index = new PlayersIndex();
        index.find(players, 'a');
        const added = player('b');
        index.push(players, added);
        expect(players).toHaveLength(2);
        expect(index.find(players, 'b')).toBe(added);
    });

    it('sees a player pushed to the array behind its back', () => {
        const players = [player('a')];
        const index = new PlayersIndex();
        index.find(players, 'a');
        const added = player('b');
        players.push(added);
        expect(index.find(players, 'b')).toBe(added);
    });

    it('drops a player removed from the array, whatever its position', () => {
        const players = [player('a'), player('b'), player('c')];
        const index = new PlayersIndex();
        expect(index.find(players, 'c')).toBe(players[2]);
        players.splice(0, 1);
        expect(index.find(players, 'a')).toBeUndefined();
        expect(index.find(players, 'c')).toBe(players[1]);
    });

    it('does not keep a removed player when another one was pushed so the length is the same', () => {
        const players = [player('a'), player('b'), player('c')];
        const index = new PlayersIndex();
        index.find(players, 'a');
        players.splice(0, 1);
        players.push(player('d'));
        expect(index.find(players, 'a')).toBeUndefined();
        expect(index.find(players, 'd')).toBe(players[2]);
    });

    it('follows an array that was replaced', () => {
        const first = [player('a')];
        const second = [player('b')];
        const index = new PlayersIndex();
        expect(index.find(first, 'a')).toBe(first[0]);
        expect(index.find(second, 'a')).toBeUndefined();
        expect(index.find(second, 'b')).toBe(second[0]);
    });

    it('push on an index that was never built still pushes', () => {
        const players = [player('a')];
        const index = new PlayersIndex();
        index.push(players, player('b'));
        expect(players.map((p: any) => p.license)).toEqual(['a', 'b']);
        expect(index.find(players, 'b')).toBe(players[1]);
    });
});


suite('ActionsIndex', () => {
    it('returns the actions that share an identifier, in array order and once each', () => {
        const actions = [action('1', ['x', 'y']), action('2', ['z']), action('3', ['y', 'x'])];
        const found = new ActionsIndex().candidates(actions, ['x', 'y', 'x'], undefined);
        expect(found).toEqual([actions[0], actions[2]]);
        expect(found[0]).toBe(actions[0]);
    });

    it('ignores the hwids unless they are asked for', () => {
        const actions = [action('1', ['x'], ['h1']), action('2', ['y'], ['h2'])];
        const index = new ActionsIndex();
        expect(index.candidates(actions, [], undefined)).toEqual([]);
        expect(index.candidates(actions, [], ['h2'])).toEqual([actions[1]]);
        expect(index.candidates(actions, ['x'], ['h2'])).toEqual([actions[0], actions[1]]);
    });

    it('sees an action added through push and one pushed behind its back', () => {
        const actions = [action('1', ['x'])];
        const index = new ActionsIndex();
        index.candidates(actions, ['x'], undefined);
        index.push(actions, action('2', ['x']));
        actions.push(action('3', ['x']));
        expect(index.candidates(actions, ['x'], undefined).map((a: any) => a.id)).toEqual(['1', '2', '3']);
    });

    it('drops actions removed from the array and follows the shifted positions', () => {
        const actions = [action('1', ['x']), action('2', ['x']), action('3', ['x'])];
        const index = new ActionsIndex();
        index.candidates(actions, ['x'], undefined);
        actions.splice(0, 1);
        actions.push(action('4', ['y']));
        expect(index.candidates(actions, ['x'], undefined).map((a: any) => a.id)).toEqual(['2', '3']);
    });

    it('keeps an action whose hwids were wiped as a candidate, the caller filters it', () => {
        const actions = [action('1', ['x'], ['h1'])];
        const index = new ActionsIndex();
        index.candidates(actions, [], ['h1']);
        actions[0].hwids = [];
        expect(index.candidates(actions, [], ['h1'])).toEqual([actions[0]]);
    });

    it('skips an action with a broken ids field instead of failing', () => {
        const actions = [{ id: '1', ids: undefined } as any, action('2', ['x'])];
        expect(new ActionsIndex().candidates(actions, ['x'], undefined)).toEqual([actions[1]]);
    });
});
