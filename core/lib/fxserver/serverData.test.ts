import { suite, it, expect, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getServerDataConfigs } from './serverData';


suite('getServerDataConfigs', () => {
    let dataPath: string;
    beforeEach(async () => {
        dataPath = await fsp.mkdtemp(path.join(os.tmpdir(), 'tx-serverdata-'));
    });
    afterEach(async () => {
        await fsp.rm(dataPath, { recursive: true, force: true });
    });

    it('reads small cfg files and ignores other files', async () => {
        await fsp.writeFile(path.join(dataPath, 'server.cfg'), 'endpoint_add_tcp "0.0.0.0:30120"');
        await fsp.writeFile(path.join(dataPath, 'notes.txt'), 'not a cfg');
        const configs = await getServerDataConfigs(dataPath, [['server.cfg', 33], ['notes.txt', 9]]);
        expect(configs).toEqual([['server.cfg', 'endpoint_add_tcp "0.0.0.0:30120"']]);
    });

    it('reports an oversized cfg once and never reads it', async () => {
        const bigSize = 40 * 1024;
        await fsp.writeFile(path.join(dataPath, 'big.cfg'), 'x'.repeat(bigSize));
        const configs = await getServerDataConfigs(dataPath, [['big.cfg', bigSize]]);
        expect(configs).toEqual([['big.cfg', 'file is too big']]);
    });
});
