//@ts-nocheck
import { suite, it, describe, expect, vi, beforeEach, afterEach } from 'vitest';
import FxPlayerPositions from './FxPlayerPositions';

const report = (players: unknown, extra = {}) => ({ type: 'txAdminPlayerPositions', players, ...extra });

suite('FxPlayerPositions', () => {
    let positions: FxPlayerPositions;
    let roomSize: number;
    let child: { mutex: string; isAlive: boolean };

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 29, 12, 0, 0));
        roomSize = 0;
        child = { mutex: 'm1', isAlive: true };
        vi.stubGlobal('txConfig', { server: { onesync: 'on' } });
        vi.stubGlobal('txCore', {
            fxRunner: { get child() { return child; }, sendEvent: vi.fn() },
            webServer: { webSocket: { pushRefresh: vi.fn(), getRoomSize: () => roomSize } },
        });
        positions = new FxPlayerPositions();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('starts empty, with the server mutex and the onesync mode', () => {
        expect(positions.getRoomData()).toEqual({ mutex: 'm1', onesync: 'on', ts: 0, players: [] });
    });

    it('stores a report, shares it with the room and pushes a refresh', () => {
        positions.handleReport(report([[1, 100.5, -200, 0], [2, 3000, 4000, 1]]));
        expect(txCore.webServer.webSocket.pushRefresh).toHaveBeenCalledWith('playermap');
        expect(positions.getRoomData()).toEqual({
            mutex: 'm1',
            onesync: 'on',
            ts: Date.now(),
            players: [[1, 100.5, -200, 0], [2, 3000, 4000, 1]],
        });
    });

    it('hides positions older than 15 seconds', () => {
        positions.handleReport(report([[1, 1, 1, 0]]));
        vi.setSystemTime(Date.now() + 14_000);
        expect(positions.getRoomData().players).toHaveLength(1);
        vi.setSystemTime(Date.now() + 2_000);
        expect(positions.getRoomData().players).toEqual([]);
    });

    it.each([
        ['not an object', 'x'],
        ['wrong type tag', { type: 'other', players: [] }],
        ['players not an array', report('nope')],
        ['more than 4096 players', report(Array.from({ length: 4097 }, (_, i) => [i, 0, 0, 0]))],
    ])('ignores a report with %s and keeps the previous positions', (_label, payload) => {
        positions.handleReport(report([[7, 7, 7, 0]]));
        txCore.webServer.webSocket.pushRefresh.mockClear();
        positions.handleReport(payload);
        expect(txCore.webServer.webSocket.pushRefresh).not.toHaveBeenCalled();
        expect(positions.getRoomData().players).toEqual([[7, 7, 7, 0]]);
    });

    it.each([
        ['an entry that is not a tuple of 4', [1, 2, 3]],
        ['an entry that is not an array', 'x'],
        ['a null entry', null],
        ['a non integer netid', [1.5, 1, 1, 0]],
        ['a negative netid', [-1, 1, 1, 0]],
        ['a netid above 65535', [65536, 1, 1, 0]],
        ['a string coordinate', [1, '5', 1, 0]],
        ['a null coordinate (what the json of the server writes for NaN or inf)', [1, null, null, 0]],
        ['a NaN coordinate', [1, NaN, 1, 0]],
        ['an infinite coordinate', [1, Infinity, 1, 0]],
        ['a coordinate just outside the map', [1, 20001, 1, 0]],
        ['a coordinate far outside the map', [1, 1e9, 1, 0]],
        ['a vehicle type out of range', [1, 1, 1, 99]],
    ])('drops only the entry with %s and keeps the other players', (_label, bad) => {
        positions.handleReport(report([[10, 100, 100, 0], bad, [20, 200, 200, 1]]));
        expect(positions.getRoomData().players).toEqual([[10, 100, 100, 0], [20, 200, 200, 1]]);
        expect(txCore.webServer.webSocket.pushRefresh).toHaveBeenCalledWith('playermap');
    });

    it('one bad entry among 100 good ones leaves 100 on the map', () => {
        const players = Array.from({ length: 100 }, (_, i) => [i + 1, i, i, 0]);
        positions.handleReport(report([...players, [500, 20001, 0, 0]]));
        expect(positions.getRoomData().players).toHaveLength(100);
    });

    it('a report of only bad entries shows nobody, it does not keep the old positions as if they were new', () => {
        positions.handleReport(report([[7, 7, 7, 0]]));
        positions.handleReport(report([[1, null, null, 0]]));
        expect(positions.getRoomData().players).toEqual([]);
    });

    it('keeps the last entry when a netid appears twice', () => {
        positions.handleReport(report([[1, 1, 1, 0], [2, 2, 2, 0], [1, 9, 9, 1]]));
        expect(positions.getRoomData().players).toEqual([[2, 2, 2, 0], [1, 9, 9, 1]]);
    });

    it('does not keep a reference to the payload it was given', () => {
        const players = [[1, 1, 1, 0]];
        positions.handleReport(report(players));
        players[0][1] = 999;
        expect(positions.getRoomData().players[0][1]).toBe(1);
    });

    it('forgets the positions and refreshes the room when the server closes', () => {
        positions.handleReport(report([[1, 1, 1, 0]]));
        txCore.webServer.webSocket.pushRefresh.mockClear();
        positions.handleServerClose();
        expect(positions.getRoomData().players).toEqual([]);
        expect(txCore.webServer.webSocket.pushRefresh).toHaveBeenCalledWith('playermap');
    });

    describe('positions that are not renewed', () => {
        it('are cleared and pushed to the room once, so an open map does not keep showing them as live', () => {
            positions.handleReport(report([[1, 1, 1, 0]]));
            txCore.webServer.webSocket.pushRefresh.mockClear();
            vi.advanceTimersByTime(15_000);
            expect(txCore.webServer.webSocket.pushRefresh).not.toHaveBeenCalled();
            expect(positions.getRoomData().players).toHaveLength(1);
            vi.advanceTimersByTime(5_000);
            expect(txCore.webServer.webSocket.pushRefresh).toHaveBeenCalledTimes(1);
            expect(txCore.webServer.webSocket.pushRefresh).toHaveBeenCalledWith('playermap');
            expect(positions.getRoomData().players).toEqual([]);
            vi.advanceTimersByTime(30_000);
            expect(txCore.webServer.webSocket.pushRefresh).toHaveBeenCalledTimes(1);
        });

        it('are cleared even when nobody is on the map or the server is down (the check does not depend on asking)', () => {
            roomSize = 0;
            child = undefined;
            positions.handleReport(report([[1, 1, 1, 0]]));
            txCore.webServer.webSocket.pushRefresh.mockClear();
            vi.advanceTimersByTime(25_000);
            expect(txCore.webServer.webSocket.pushRefresh).toHaveBeenCalledTimes(1);
        });

        it('stay when reports keep coming', () => {
            for (let i = 0; i < 6; i++) {
                positions.handleReport(report([[1, 1, 1, 0]]));
                txCore.webServer.webSocket.pushRefresh.mockClear();
                vi.advanceTimersByTime(5_000);
            }
            expect(txCore.webServer.webSocket.pushRefresh).not.toHaveBeenCalled();
            expect(positions.getRoomData().players).toHaveLength(1);
        });
    });

    describe('asking the server for positions', () => {
        it('asks every 5 seconds while someone is on the map, with a time to live', () => {
            roomSize = 2;
            vi.advanceTimersByTime(5_000);
            expect(txCore.fxRunner.sendEvent).toHaveBeenCalledTimes(1);
            expect(txCore.fxRunner.sendEvent).toHaveBeenCalledWith('playerPositionsWanted', { ttlMs: 20_000 });
            vi.advanceTimersByTime(10_000);
            expect(txCore.fxRunner.sendEvent).toHaveBeenCalledTimes(3);
        });

        it('stays quiet when nobody is on the map', () => {
            roomSize = 0;
            vi.advanceTimersByTime(30_000);
            expect(txCore.fxRunner.sendEvent).not.toHaveBeenCalled();
        });

        it('stays quiet when the server is not running', () => {
            roomSize = 1;
            child = { mutex: 'm1', isAlive: false };
            vi.advanceTimersByTime(10_000);
            expect(txCore.fxRunner.sendEvent).not.toHaveBeenCalled();
            child = undefined;
            vi.advanceTimersByTime(10_000);
            expect(txCore.fxRunner.sendEvent).not.toHaveBeenCalled();
        });
    });
});
