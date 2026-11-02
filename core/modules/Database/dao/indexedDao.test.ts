//@ts-nocheck
import { suite, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chain } from 'lodash-es';

vi.mock('@core/globalData', () => ({ txEnv: { profilePath: '/tmp/txtest-db' }, txHostConfig: {}, txDevEnv: {} }));

import PlayersDao from './players';
import ActionsDao from './actions';
import CleanupDao from './cleanup';
import { DuplicateKeyError } from '../dbUtils';


//The queries as they were before the indexes, run on the same arrays: the answer of the daos must be identical
const referenceFindOne = (data, license) => {
    const p = chain(data).get('players').find({ license }).cloneDeep().value();
    return typeof p === 'undefined' ? null : p;
};

const referenceFindMany = (data, idsArray, hwidsArray, customFilter = {}) => {
    const idsFilter = (action) => idsArray.some((fi) => action.ids.includes(fi));
    const hwidsFilter = (action) => {
        if ('hwids' in action && action.hwids) {
            const count = hwidsArray.filter((fi) => action.hwids?.includes(fi)).length;
            return count >= txConfig.banlist.requiredHwidMatches;
        }
        return false;
    };
    const idsMatchFilter = hwidsArray && hwidsArray.length && txConfig.banlist.requiredHwidMatches
        ? (a) => idsFilter(a) || hwidsFilter(a)
        : (a) => idsFilter(a);
    return chain(data).get('actions')
        .filter(customFilter)
        .filter(idsMatchFilter)
        .cloneDeep()
        .value()
        .sort((a, b) => a.timestamp - b.timestamp);
};


const mulberry32 = (seed) => () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

const makeDb = (data) => {
    const obj = { data };
    obj.chain = chain(obj).get('data');
    return { obj, isReady: true, writeFlag: vi.fn() };
};

const setup = () => {
    const data = { players: [], actions: [], whitelistApprovals: [], whitelistRequests: [] };
    const db = makeDb(data);
    return { data, db, players: new PlayersDao(db), actions: new ActionsDao(db), cleanup: new CleanupDao(db) };
};

const hex40 = (n) => n.toString(16).padStart(40, '0');
const newPlayer = (license, n) => ({
    license,
    ids: [`license:${license}`],
    hwids: [],
    displayName: `p${n}`,
    pureName: `p${n}`,
    playTime: n % 300,
    tsLastConnection: n,
    tsJoined: n,
    notes: { text: '', lastAdmin: null, tsLastEdit: null },
});


suite('indexed daos', () => {
    beforeEach(() => {
        vi.stubGlobal('txConfig', { banlist: { requiredHwidMatches: 1 } });
        vi.stubGlobal('txCore', { fxPlayerlist: { handleDbDataSync: vi.fn() } });
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('players: register, find, update and the duplicate check behave as before', () => {
        const { data, players } = setup();
        const license = hex40(1);
        expect(players.findOne(license)).toBeNull();
        players.register(newPlayer(license, 1));
        expect(data.players).toHaveLength(1);
        expect(() => players.register(newPlayer(license, 2))).toThrow(DuplicateKeyError);
        expect(data.players).toHaveLength(1);

        const found = players.findOne(license);
        expect(found).toEqual(data.players[0]);
        expect(found).not.toBe(data.players[0]);
        found.displayName = 'changed outside';
        expect(data.players[0].displayName).toBe('p1');

        const returned = players.update(license, { displayName: 'new', playTime: 99 }, Symbol('src'));
        expect(returned).toEqual(data.players[0]);
        expect(returned).not.toBe(data.players[0]);
        expect(data.players[0]).toMatchObject({ displayName: 'new', playTime: 99, license });
        expect(txCore.fxPlayerlist.handleDbDataSync).toHaveBeenCalledTimes(1);

        expect(() => players.update(hex40(2), { displayName: 'x' }, Symbol('src'))).toThrow('Player not found in database');
        expect(() => players.update(license, { license: 'other' }, Symbol('src'))).toThrow('cannot license field');
        expect(() => players.findOne('not a license')).toThrow('Invalid reference type');
    });

    it('actions: register, revoke and ack keep working through the index', () => {
        const { actions } = setup();
        const banId = actions.registerBan(['license:a'], 'admin', 'reason', false, 'name', ['hw1']);
        const warnId = actions.registerWarn(['license:a'], 'admin', 'reason', 'name');
        expect(actions.findMany(['license:a']).map((a) => a.id)).toEqual([banId, warnId]);
        expect(actions.findMany(['license:zzz'])).toEqual([]);
        expect(actions.findMany([], ['hw1']).map((a) => a.id)).toEqual([banId]);
        actions.revoke(banId, 'admin');
        expect(actions.findMany(['license:a'], undefined, { type: 'ban' })[0].revocation.author).toBe('admin');
        actions.ackWarn(warnId);
        expect(actions.findOne(warnId).acked).toBe(true);
    });

    it('a ban registered after a cleanup removed actions and before any lookup is not missed', () => {
        for (const removed of [1, 2]) {
            for (const kind of ['ban', 'warn']) {
                const { actions, cleanup } = setup();
                const oldIds = Array.from({ length: 4 }, (_, i) => `license:old${i}`);
                oldIds.forEach((id) => actions.registerWarn([id], 'admin', 'reason', 'name'));
                expect(actions.findMany(oldIds)).toHaveLength(4);

                const doomed = new Set(oldIds.slice(0, removed));
                cleanup.bulkRemove('actions', (a) => doomed.has(a.ids[0]));
                const newIds = Array.from({ length: removed }, (_, i) => `license:new${i}`);
                const registered = newIds.map((id) => kind === 'ban'
                    ? actions.registerBan([id], 'admin', 'reason', false, 'name', [])
                    : actions.registerWarn([id], 'admin', 'reason', 'name'));

                newIds.forEach((id, i) => {
                    expect(actions.findMany([id]).map((a) => a.id), `${kind} ${id} after ${removed} removed`).toEqual([registered[i]]);
                });
                oldIds.slice(0, removed).forEach((id) => expect(actions.findMany([id])).toEqual([]));
            }
        }
    });

    it('a player registered after a cleanup removed players and before any lookup is not missed', () => {
        const { players, cleanup } = setup();
        const licenses = Array.from({ length: 4 }, (_, i) => hex40(i + 1));
        licenses.forEach((license, i) => players.register(newPlayer(license, i + 1)));
        expect(players.findOne(licenses[3])).not.toBeNull();

        cleanup.bulkRemove('players', (p) => p.license === licenses[0]);
        const fresh = hex40(99);
        players.register(newPlayer(fresh, 99));
        expect(players.findOne(fresh)).toMatchObject({ license: fresh });
        expect(players.findOne(licenses[0])).toBeNull();
        expect(() => players.register(newPlayer(fresh, 100))).toThrow(DuplicateKeyError);
    });

    it('findMany returns copies, changing them does not change the database', () => {
        const { data, actions } = setup();
        actions.registerBan(['license:a'], 'admin', 'reason', false, 'name', ['hw']);
        const [copy] = actions.findMany(['license:a']);
        copy.reason = 'changed';
        copy.ids.push('license:injected');
        expect(data.actions[0].reason).toBe('reason');
        expect(data.actions[0].ids).toEqual(['license:a']);
        expect(actions.findMany(['license:injected'])).toEqual([]);
    });

    it('answers exactly like the previous queries over thousands of random operations', () => {
        const random = mulberry32(20261102);
        const pick = (list) => list[Math.floor(random() * list.length)];
        const { data, players, actions, cleanup } = setup();

        const licensePool = Array.from({ length: 70 }, (_, i) => hex40(i + 1));
        const idPool = [
            ...licensePool.slice(0, 40).map((l) => `license:${l}`),
            ...Array.from({ length: 25 }, (_, i) => `discord:${100 + i}`),
            ...Array.from({ length: 25 }, (_, i) => `steam:${200 + i}`),
        ];
        const hwidPool = Array.from({ length: 30 }, (_, i) => `5:hwid${i}`);
        const sample = (pool, min, max) => {
            const count = min + Math.floor(random() * (max - min + 1));
            return Array.from({ length: count }, () => pick(pool));
        };
        const activeBan = (a) => a.type === 'ban' && a.revocation.timestamp === null && (a.expiration === false || a.expiration > 5);

        let nextPlayer = 1;
        const operations = [
            () => {
                const license = pick(licensePool);
                const exists = data.players.some((p) => p.license === license);
                if (exists) {
                    expect(() => players.register(newPlayer(license, nextPlayer++))).toThrow(DuplicateKeyError);
                } else {
                    players.register(newPlayer(license, nextPlayer++));
                }
            },
            () => {
                const license = pick(licensePool);
                const before = data.players.find((p) => p.license === license);
                if (before) {
                    const returned = players.update(license, { displayName: `u${nextPlayer++}` }, Symbol('src'));
                    expect(returned).toEqual(before);
                } else {
                    expect(() => players.update(license, { displayName: 'x' }, Symbol('src'))).toThrow();
                }
            },
            () => {
                const id = actions.registerBan(sample(idPool, 1, 3), 'admin', 'reason', random() < 0.5 ? false : Math.floor(random() * 20), 'name', sample(hwidPool, 0, 3));
                data.actions.at(-1).timestamp = Math.floor(random() * 6);
                if (random() < 0.3) data.actions.at(-1).hwids = undefined;
                return id;
            },
            () => {
                actions.registerWarn(sample(idPool, 1, 3), 'admin', 'reason', 'name');
                data.actions.at(-1).timestamp = Math.floor(random() * 6);
            },
            () => {
                if (data.actions.length) actions.revoke(pick(data.actions).id, 'admin');
            },
            () => {
                const warns = data.actions.filter((a) => a.type === 'warn');
                if (warns.length) actions.ackWarn(pick(warns).id);
            },
            () => {
                cleanup.wipeHwids(random() < 0.5, random() < 0.5);
            },
            () => {
                const limit = Math.floor(random() * 120);
                cleanup.bulkRemove('players', (p) => p.tsLastConnection < limit);
            },
            () => {
                cleanup.bulkRemove('actions', (a) => a.type === 'warn' && random() < 0.5);
            },
            () => {
                data.actions = data.actions.filter(() => random() < 0.8);
            },
            () => {
                if (data.actions.length) data.actions.splice(Math.floor(random() * data.actions.length), 1);
                if (data.players.length) data.players.splice(Math.floor(random() * data.players.length), 1);
            },
            () => {
                data.players.unshift(newPlayer(pick(licensePool), nextPlayer++));
                data.actions.unshift({ id: `X${nextPlayer++}`, type: 'ban', ids: sample(idPool, 1, 2), hwids: sample(hwidPool, 0, 2), timestamp: 3, expiration: false, revocation: { timestamp: null, author: null } });
            },
        ];

        const appOperations = operations.slice(0, -2);
        let compared = 0;
        let nonEmpty = 0;
        for (let step = 0; step < 2500; step++) {
            //Several writes before a lookup only with what the app does (daos, cleanup, a replaced array).
            //The two last operations write into the arrays directly, nothing does that: alone they change the length.
            const burst = random() < 0.35 ? 1 + Math.floor(random() * 3) : 1;
            for (let b = 0; b < burst; b++) pick(burst > 1 ? appOperations : operations)();

            for (let q = 0; q < 6; q++) {
                txConfig.banlist.requiredHwidMatches = pick([0, 1, 1, 2]);
                const ids = random() < 0.2 ? [] : sample(idPool, 1, 4);
                const hwids = pick([undefined, [], sample(hwidPool, 1, 4)]);
                const filter = pick([undefined, { type: 'ban' }, { type: 'warn' }, activeBan]);
                const expected = referenceFindMany(data, ids, hwids, filter);
                const got = actions.findMany(ids, hwids, filter);
                expect(got).toEqual(expected);
                compared++;
                if (expected.length) nonEmpty++;

                const license = pick(licensePool);
                expect(players.findOne(license)).toEqual(referenceFindOne(data, license));
            }
        }
        expect(compared).toBe(2500 * 6);
        expect(nonEmpty).toBeGreaterThan(1500);
        expect(data.players.length).toBeGreaterThan(0);
        expect(data.actions.length).toBeGreaterThan(0);
    });
});
