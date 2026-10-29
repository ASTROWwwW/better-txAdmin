//@ts-nocheck
import { suite, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getProcessRss = vi.hoisted(() => vi.fn());
vi.mock('@lib/host/getProcessRss', () => ({ default: getProcessRss }));
vi.mock('@core/globalData', () => ({ txEnv: { profilePath: '/nonexistent-profile', txaVersion: '9.9.9' }, txDevEnv: {}, txHostConfig: {} }));
vi.mock('@lib/console', () => {
    const noop = () => { };
    const verbose = { warn: noop, error: noop, log: noop, debug: noop, dir: noop };
    return { default: () => ({ warn: noop, error: noop, log: noop, debug: noop, verbose }) };
});

import SvRuntimeMetrics from './index';

const MB = 1024 * 1024;

suite('SvRuntimeMetrics external memory fallback', () => {
    let metrics: SvRuntimeMetrics;
    let child: { isAlive: boolean; pid: number };

    const report = (rss: number) => metrics.logServerNodeMemory({ ts: Date.now(), used: 10, limit: 100, rss });

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 29, 12, 0, 0));
        getProcessRss.mockReset();
        child = { isAlive: true, pid: 4242 };
        vi.stubGlobal('txCore', {
            fxRunner: { get child() { return child; } },
            webServer: { webSocket: { pushRefresh: vi.fn() } },
        });
        metrics = new SvRuntimeMetrics();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('has no memory at all before any report or measure', () => {
        expect(metrics.getFxsMemory()).toBeUndefined();
        expect(metrics.getRecentStats().fxsMemory).toBeUndefined();
    });

    it('measures the process from the OS when the server stopped reporting', async () => {
        getProcessRss.mockResolvedValue(512 * MB);
        await metrics.refreshExternalFxsMemory();
        expect(getProcessRss).toHaveBeenCalledWith(4242);
        expect(metrics.getFxsMemory()).toBe(512);
        expect(metrics.getRecentStats().fxsMemory).toBe(512);
        expect(metrics.getRecentStats().nodeMemory).toBeUndefined(); //the heap cannot be read from outside
    });

    it('rounds to two decimals, like the server report', async () => {
        getProcessRss.mockResolvedValue(1234567);
        await metrics.refreshExternalFxsMemory();
        expect(metrics.getFxsMemory()).toBe(1.18);
    });

    it('does not ask the OS while the server reports', async () => {
        report(700);
        await metrics.refreshExternalFxsMemory();
        expect(getProcessRss).not.toHaveBeenCalled();
        expect(metrics.getFxsMemory()).toBe(700);
    });

    it('asks the OS once the last report is too old, and expires its own value after 90 seconds', async () => {
        report(700);
        vi.setSystemTime(Date.now() + 40_000);
        getProcessRss.mockResolvedValue(900 * MB);
        await metrics.refreshExternalFxsMemory();
        expect(metrics.getFxsMemory()).toBe(900);
        vi.setSystemTime(Date.now() + 91_000);
        expect(metrics.getFxsMemory()).toBeUndefined();
    });

    it('prefers a fresh server report over the OS measure', async () => {
        getProcessRss.mockResolvedValue(900 * MB);
        await metrics.refreshExternalFxsMemory();
        report(650);
        expect(metrics.getFxsMemory()).toBe(650);
    });

    it('does nothing when the server process is not alive', async () => {
        child = { isAlive: false, pid: 4242 };
        await metrics.refreshExternalFxsMemory();
        expect(getProcessRss).not.toHaveBeenCalled();
        expect(metrics.getFxsMemory()).toBeUndefined();
    });

    it('survives a failed or empty OS query and keeps no value', async () => {
        getProcessRss.mockRejectedValueOnce(new Error('boom'));
        await expect(metrics.refreshExternalFxsMemory()).resolves.toBeUndefined();
        getProcessRss.mockResolvedValueOnce(undefined);
        await metrics.refreshExternalFxsMemory();
        expect(metrics.getFxsMemory()).toBeUndefined();
    });

    it('runs one OS query at a time', async () => {
        let release: (v: number) => void;
        getProcessRss.mockReturnValue(new Promise((resolve) => { release = resolve; }));
        const first = metrics.refreshExternalFxsMemory();
        const second = metrics.refreshExternalFxsMemory();
        release!(100 * MB);
        await Promise.all([first, second]);
        expect(getProcessRss).toHaveBeenCalledTimes(1);
    });

    it('forgets the OS measure when the server boots again', async () => {
        getProcessRss.mockResolvedValue(900 * MB);
        await metrics.refreshExternalFxsMemory();
        metrics.logServerBoot(5000);
        expect(metrics.getFxsMemory()).toBeUndefined();
    });
});
