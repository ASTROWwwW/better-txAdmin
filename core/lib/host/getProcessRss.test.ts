import { suite, it, expect, vi, afterEach } from 'vitest';

const getProcessTree = vi.hoisted(() => vi.fn());
vi.mock('./getProcessTree', () => ({ default: getProcessTree }));

import getProcessRss from './getProcessRss';

const setPlatform = (platform: string) => Object.defineProperty(process, 'platform', { value: platform });
const realPlatform = process.platform;

suite('getProcessRss', () => {
    afterEach(() => {
        setPlatform(realPlatform);
        getProcessTree.mockReset();
    });

    it.skipIf(realPlatform !== 'linux')('reads the resident memory of a live process from /proc, in bytes', async () => {
        const rss = await getProcessRss(process.pid);
        const expected = process.memoryUsage.rss();
        expect(rss).toBeTypeOf('number');
        expect(rss!).toBeGreaterThan(expected / 2);
        expect(rss!).toBeLessThan(expected * 2);
    });

    it.skipIf(realPlatform !== 'linux')('returns undefined for a process that does not exist', async () => {
        expect(await getProcessRss(2 ** 31 - 2)).toBeUndefined();
    });

    it('takes the root process working set from the OS query on Windows', async () => {
        setPlatform('win32');
        getProcessTree.mockResolvedValue({ ts: 1, procs: [{ pid: 77, memory: 123_456_789 }, { pid: 78, memory: 5 }] });
        expect(await getProcessRss(77)).toBe(123_456_789);
        expect(getProcessTree).toHaveBeenCalledWith(77);
    });

    it('returns undefined on Windows when the query fails or the memory is unknown', async () => {
        setPlatform('win32');
        getProcessTree.mockRejectedValueOnce(new Error('PowerShell process query failed: timed out'));
        expect(await getProcessRss(77)).toBeUndefined();
        getProcessTree.mockResolvedValueOnce({ ts: 1, procs: [{ pid: 77, memory: null }] });
        expect(await getProcessRss(77)).toBeUndefined();
    });

    it('returns undefined on a platform with no support', async () => {
        setPlatform('darwin');
        expect(await getProcessRss(1)).toBeUndefined();
    });
});
