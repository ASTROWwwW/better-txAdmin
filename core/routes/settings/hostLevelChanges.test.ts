import { suite, it, expect } from 'vitest';
import { getHostLevelChanges } from './hostLevelChanges';

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
});
