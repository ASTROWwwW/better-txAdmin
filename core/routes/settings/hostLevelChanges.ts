import path from 'node:path';
import slash from 'slash';
import { dequal } from 'dequal';

//Where the server files are and how the server is started. With the cfg editor, the first two reach any file
//of the host, and the third one is the command line of the server process.
const HOST_LEVEL_SERVER_KEYS = ['dataPath', 'cfgPath', 'startupArgs'] as const;

//The same folder can be stored with other slashes or a trailing one, depending on what saved it
const normalize = (value: unknown) => {
    return typeof value === 'string' ? slash(path.normalize(value)).replace(/\/+$/, '') : value;
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
