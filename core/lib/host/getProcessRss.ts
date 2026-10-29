import fsp from 'node:fs/promises';
import getProcessTree from './getProcessTree';
import { isExpectedProcReadError, parseLinuxVmRss } from './processTreeUtils';

/**
 * Returns the resident memory of one process in bytes, asked to the OS from outside the process,
 * or undefined if it cannot be read (the process is gone, unsupported platform, query failed).
 *
 * Linux reads `/proc/<pid>/status`. Windows has no cheaper way than the PowerShell query the process
 * tree uses (~0.5s), so callers must not use it on a tight timer.
 */
export default async function getProcessRss(pid: number): Promise<number | undefined> {
    if (process.platform === 'linux') {
        try {
            const status = await fsp.readFile(`/proc/${pid}/status`, 'utf8');
            return parseLinuxVmRss(status) ?? undefined;
        } catch (error) {
            if (isExpectedProcReadError(error)) return undefined;
            throw error;
        }
    } else if (process.platform === 'win32') {
        try {
            const { procs } = await getProcessTree(pid);
            return procs[0]?.memory ?? undefined;
        } catch (error) {
            return undefined;
        }
    }
    return undefined;
}
