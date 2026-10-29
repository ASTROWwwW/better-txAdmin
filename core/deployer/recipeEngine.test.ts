//@ts-nocheck
import { suite, it, expect, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import recipeEngine from './recipeEngine';


const buildStoredZip = (entries: { name: string; data: string }[]) => {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;
    for (const { name, data } of entries) {
        const nameBuf = Buffer.from(name);
        const dataBuf = Buffer.from(data);
        const crc = crc32(dataBuf);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(dataBuf.length, 18);
        local.writeUInt32LE(dataBuf.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        locals.push(local, nameBuf, dataBuf);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(dataBuf.length, 20);
        central.writeUInt32LE(dataBuf.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, nameBuf);

        offset += local.length + nameBuf.length + dataBuf.length;
    }
    const centralDir = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralDir.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, centralDir, end]);
};


suite('unzip task', () => {
    let basePath: string;
    beforeEach(async () => {
        basePath = await fsp.mkdtemp(path.join(os.tmpdir(), 'tx-recipe-unzip-'));
        await fsp.mkdir(path.join(basePath, 'deploy'));
    });
    afterEach(async () => {
        await fsp.rm(basePath, { recursive: true, force: true });
    });

    const unzip = (zipName: string) => recipeEngine.unzip.run(
        { src: zipName, dest: 'deploy/out' },
        path.join(basePath, 'deploy'),
        {},
    );

    it('extracts regular entries', async () => {
        const zipBuf = buildStoredZip([{ name: 'a/b.txt', data: 'hello' }]);
        await fsp.writeFile(path.join(basePath, 'deploy', 'ok.zip'), zipBuf);
        await unzip('ok.zip');
        const extracted = await fsp.readFile(path.join(basePath, 'deploy', 'deploy', 'out', 'a', 'b.txt'), 'utf8');
        expect(extracted).toBe('hello');
    });

    it('refuses entries that climb out of the destination', async () => {
        const zipBuf = buildStoredZip([{ name: '../../escaped.txt', data: 'pwned' }]);
        await fsp.writeFile(path.join(basePath, 'deploy', 'evil.zip'), zipBuf);
        await expect(unzip('evil.zip')).rejects.toThrow('Malicious entry');
        await expect(fsp.access(path.join(basePath, 'deploy', 'escaped.txt'))).rejects.toThrow();
    });
});
