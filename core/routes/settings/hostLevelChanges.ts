import path from 'node:path';
import slash from 'slash';
import { dequal } from 'dequal';

//Where the server files are and how the server is started. With the cfg editor, the first two reach any file
//of the host, and the third one is the command line of the server process.
const HOST_LEVEL_SERVER_KEYS = ['dataPath', 'cfgPath', 'startupArgs'] as const;

//The same folder can be stored with other slashes or a trailing one, depending on what saved it, and the
//settings page shows the startup arguments as one line that it splits again on spaces
const normalize = (value: unknown) => {
    if (typeof value === 'string') return slash(path.normalize(value)).replace(/\/+$/, '');
    if (Array.isArray(value)) return value.join(' ').trim().split(/\s+/);
    return value;
};

/**
 * Returns the server settings of a save request that change something only an admin with all permissions
 * may change. A key sent with the value it already has is not a change.
 */
export const getHostLevelChanges = (
    changes: { server?: Record<string, unknown> } | undefined,
    storedServer: Record<string, unknown>,
) => {
    const serverChanges = changes?.server;
    if (!serverChanges || typeof serverChanges !== 'object') return [];
    return HOST_LEVEL_SERVER_KEYS.filter((key) => {
        return Object.prototype.hasOwnProperty.call(serverChanges, key)
            && !dequal(normalize(serverChanges[key]), normalize(storedServer[key]));
    }).map((key) => `server.${key}`);
};


/**
 * Removes the host level settings from a save request, so the stored values are kept as they are.
 * Used for the admins who cannot change them: what they sent back is only another spelling of the stored
 * value, and saving that spelling could still point somewhere else (a backslash, a symlink followed by ..).
 */
export const dropHostLevelKeys = (changes: { server?: Record<string, unknown> } | undefined) => {
    const serverChanges = changes?.server;
    if (!serverChanges || typeof serverChanges !== 'object') return;
    for (const key of HOST_LEVEL_SERVER_KEYS) {
        delete serverChanges[key];
    }
    if (!Object.keys(serverChanges).length) delete changes.server;
};
