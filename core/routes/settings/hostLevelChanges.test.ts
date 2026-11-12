import { suite, it, expect } from 'vitest';
import { dropHostLevelKeys, getHostLevelChanges } from './hostLevelChanges';

const stored = { dataPath: '/srv/data', cfgPath: 'server.cfg', startupArgs: ['+set', 'x', '1'], onesync: 'on' };

suite('getHostLevelChanges', () => {
    it('finds no change when the card sends the stored values back', () => {
        const changes = { server: { dataPath: '/srv/data', cfgPath: 'server.cfg', startupArgs: ['+set', 'x', '1'], onesync: 'legacy' } };
        expect(getHostLevelChanges(changes, stored)).toEqual([]);
    });

    it('does not take another spelling of the stored folder for a change', () => {
        expect(getHostLevelChanges({ server: { dataPath: '/srv/data/' } }, stored)).toEqual([]);
        expect(getHostLevelChanges({ server: { dataPath: '/srv//data' } }, stored)).toEqual([]);
        expect(getHostLevelChanges({ server: { dataPath: '/srv/data/../other' } }, stored)).toEqual(['server.dataPath']);
    });

    it('ignores the other scopes and the other server settings', () => {
        expect(getHostLevelChanges({ server: { onesync: 'off' } }, stored)).toEqual([]);
        expect(getHostLevelChanges({ general: { serverName: 'x' } } as any, stored)).toEqual([]);
        expect(getHostLevelChanges({}, stored)).toEqual([]);
        expect(getHostLevelChanges(undefined, stored)).toEqual([]);
    });

    it('names each path or startup setting that changes', () => {
        expect(getHostLevelChanges({ server: { cfgPath: '/root/.ssh/authorized_keys' } }, stored)).toEqual(['server.cfgPath']);
        expect(getHostLevelChanges({ server: { dataPath: '/', startupArgs: ['+exec', 'x'] } }, stored))
            .toEqual(['server.dataPath', 'server.startupArgs']);
    });

    it('counts a reset as a change', () => {
        expect(getHostLevelChanges({ server: { startupArgs: Symbol('reset') } }, stored)).toEqual(['server.startupArgs']);
    });

    it('does not take the startup arguments split again by the settings page for a change', () => {
        const withSpace = { ...stored, startupArgs: ['+set', 'sv_hostname', 'My Server'] };
        expect(getHostLevelChanges({ server: { startupArgs: ['+set', 'sv_hostname', 'My', 'Server'] } }, withSpace)).toEqual([]);
        expect(getHostLevelChanges({ server: { startupArgs: ['+set', 'sv_hostname', 'Other'] } }, withSpace)).toEqual(['server.startupArgs']);
    });
});


suite('dropHostLevelKeys', () => {
    it('keeps another spelling of a path out of what gets saved', () => {
        //each of these passes as unchanged, and each would point somewhere else once stored
        for (const dataPath of ['\\srv\\data', '/srv/link/../data', '/srv/data/']) {
            const changes: any = { server: { dataPath, cfgPath: 'x/../server.cfg', onesync: 'legacy' }, general: { serverName: 'x' } };
            expect(getHostLevelChanges(changes, stored)).toEqual([]);
            dropHostLevelKeys(changes);
            expect(changes).toEqual({ server: { onesync: 'legacy' }, general: { serverName: 'x' } });
        }
    });

    it('removes the server scope when nothing else is left in it', () => {
        const changes: any = { server: { dataPath: '/srv/data', startupArgs: [] }, bans: { x: 1 } };
        dropHostLevelKeys(changes);
        expect(changes).toEqual({ bans: { x: 1 } });
    });

    it('leaves a request without server settings alone', () => {
        const changes: any = { bans: { x: 1 } };
        dropHostLevelKeys(changes);
        dropHostLevelKeys(undefined);
        expect(changes).toEqual({ bans: { x: 1 } });
    });
});
