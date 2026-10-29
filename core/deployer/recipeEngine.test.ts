//@ts-nocheck
import { suite, it, describe, expect, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import { vi } from 'vitest';
import got from '@lib/got';
import recipeEngine from './recipeEngine';

vi.mock('@lib/got', () => ({
    default: { get: vi.fn(), stream: vi.fn(() => { throw new Error('stop-before-network'); }) },
}));


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


suite('download_github validation and request', () => {
    const options = (extra: Record<string, unknown> = {}) => ({ src: 'owner/repo', dest: './resources/thing', ...extra });
    const validate = (extra: Record<string, unknown>) => recipeEngine.download_github.validate(options(extra));

    it.each([
        'main', 'v1.2.3', 'feature/foo-bar', '9fceb02d0ae598e95dc970b74767f19372d61af8', 'release_2024',
        'feature/c++', 'user@feature', 'fix#123', 'v1.0.0+build.5', 'feat(x)', 'feature/ñandú',
    ])('accepts the ref %s', (ref) => expect(validate({ ref })).toBe(true));

    it('accepts a missing or empty ref, the default branch is looked up through the api', () => {
        expect(validate({})).toBe(true);
        expect(validate({ ref: '' })).toBe(true);
    });

    it.each([
        '../../orgs/someone/repos',
        'a/../b',
        '..',
        '.',
        'a/./b',
        '/leading',
        'trailing/',
        'a//b',
        'with space',
        'tab\there',
        'new\nline',
        'a\\b',
        'x'.repeat(300),
    ])('refuses the ref %j', (ref) => expect(validate({ ref })).toBe(false));

    it.each(['@owner/repo', 'owner/repo', 'https://github.com/owner/repo/tree/main', 'my-org/my.repo_2'])(
        'accepts the source %s',
        (src) => expect(validate({ src })).toBe(true),
    );

    it.each(['../orgs', 'owner/..', './repo', '@../repo', 'justonename', ''])(
        'refuses the source %j, a dots-only segment would change the api path',
        (src) => expect(validate({ src })).toBe(false),
    );

    describe('zipball url', () => {
        const zipballUrl = async (ref: string) => {
            got.stream.mockClear();
            await expect(
                recipeEngine.download_github.run(options({ ref }), os.tmpdir(), {}),
            ).rejects.toThrow('stop-before-network');
            return got.stream.mock.calls[0][0] as string;
        };

        it('encodes each segment of the ref so it cannot add a query or a fragment', async () => {
            expect(await zipballUrl('feature/c++')).toBe('https://api.github.com/repos/owner/repo/zipball/feature/c%2B%2B');
            expect(await zipballUrl('fix#123')).toBe('https://api.github.com/repos/owner/repo/zipball/fix%23123');
            expect(await zipballUrl('q?x=1')).toBe('https://api.github.com/repos/owner/repo/zipball/q%3Fx%3D1');
        });

        it('keeps an already encoded dot dot a literal', async () => {
            expect(await zipballUrl('%2e%2e')).toBe('https://api.github.com/repos/owner/repo/zipball/%252e%252e');
        });
    });
});
