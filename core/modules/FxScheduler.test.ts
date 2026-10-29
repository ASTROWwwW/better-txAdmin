//@ts-nocheck
import { suite, it, expect, vi, beforeEach, afterEach } from 'vitest';
import FxScheduler from './FxScheduler';

const MINUTE = 60_000;

const stubRuntime = (restarter: { onlyWhenEmpty: boolean; maxRestartDelayMinutes: number }, players: { count: number }) => {
    vi.stubGlobal('txConfig', {
        general: { serverName: 'Test' },
        restarter: { schedule: ['12:00'], bootGracePeriod: 0, ...restarter },
    });
    vi.stubGlobal('txCore', {
        fxPlayerlist: { get onlineCount() { return players.count; } },
        fxRunner: { isIdle: false, child: { isAlive: true, uptime: 3_600_000 }, sendEvent: vi.fn() },
        translator: { t: (key: string) => key },
        webServer: { webSocket: { pushRefresh: vi.fn() } },
        discordBot: { sendAnnouncement: vi.fn() },
    });
};

suite('FxScheduler delayed restarts', () => {
    let scheduler: FxScheduler;
    let restartSpy: ReturnType<typeof vi.fn>;
    const players = { count: 0 };

    const build = (restarter: { onlyWhenEmpty: boolean; maxRestartDelayMinutes: number }) => {
        stubRuntime(restarter, players);
        scheduler = new FxScheduler();
        restartSpy = vi.spyOn(scheduler, 'triggerServerRestart').mockResolvedValue(undefined) as any;
    };
    const tick = async (minutes = 1) => {
        vi.setSystemTime(Date.now() + minutes * MINUTE);
        await scheduler.checkSchedule();
    };

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 29, 11, 59, 30)); //local time, 30s before the scheduled restart
        players.count = 0;
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('restarts right away at the scheduled time when the delay option is off', async () => {
        build({ onlyWhenEmpty: false, maxRestartDelayMinutes: 30 });
        players.count = 5;
        await tick(); //12:00:30
        expect(restartSpy).toHaveBeenCalledTimes(1);
    });

    it('restarts right away when the server is empty, even with the delay option on', async () => {
        build({ onlyWhenEmpty: true, maxRestartDelayMinutes: 30 });
        await tick();
        expect(restartSpy).toHaveBeenCalledTimes(1);
        expect(scheduler.getStatus().nextIsDelayed).toBe(false);
    });

    it('waits while players are online and restarts once the server is empty', async () => {
        build({ onlyWhenEmpty: true, maxRestartDelayMinutes: 30 });
        players.count = 3;
        await tick();
        expect(restartSpy).not.toHaveBeenCalled();
        expect(scheduler.getStatus().nextIsDelayed).toBe(true);

        await tick();
        await tick();
        expect(restartSpy).not.toHaveBeenCalled();

        players.count = 0;
        await tick();
        expect(restartSpy).toHaveBeenCalledTimes(1);
        expect(restartSpy.mock.calls[0][0]).toContain('(delayed)');
        expect(scheduler.getStatus().nextIsDelayed).toBe(false);
    });

    it('restarts anyway once the maximum delay is reached', async () => {
        build({ onlyWhenEmpty: true, maxRestartDelayMinutes: 2 });
        players.count = 8;
        await tick(); //delayed at 12:00:30
        await tick(); //1 min
        expect(restartSpy).not.toHaveBeenCalled();
        await tick(); //2 min
        expect(restartSpy).toHaveBeenCalledTimes(1);
    });

    it('does not restart twice for the same delayed restart', async () => {
        build({ onlyWhenEmpty: true, maxRestartDelayMinutes: 30 });
        players.count = 2;
        await tick();
        players.count = 0;
        await tick();
        await tick();
        expect(restartSpy).toHaveBeenCalledTimes(1);
    });

    it('keeps a delayed restart when a watched config is saved, and releases it once players leave', async () => {
        build({ onlyWhenEmpty: true, maxRestartDelayMinutes: 30 });
        players.count = 3;
        await tick();
        scheduler.handleConfigUpdate({} as any);
        expect(scheduler.getStatus().nextIsDelayed).toBe(true);
        players.count = 0;
        await tick();
        expect(restartSpy).toHaveBeenCalledTimes(1);
    });

    it('restarts at once when the delay option is turned off while a restart is waiting', async () => {
        build({ onlyWhenEmpty: true, maxRestartDelayMinutes: 30 });
        players.count = 3;
        await tick();
        await tick(2);
        expect(restartSpy).not.toHaveBeenCalled();
        txConfig.restarter.onlyWhenEmpty = false;
        scheduler.handleConfigUpdate({} as any);
        expect(restartSpy).toHaveBeenCalledTimes(1);
    });

    it('restarts at once when the maximum delay is lowered below the time already waited', async () => {
        build({ onlyWhenEmpty: true, maxRestartDelayMinutes: 30 });
        players.count = 3;
        await tick();
        await tick(5);
        txConfig.restarter.maxRestartDelayMinutes = 3;
        scheduler.handleConfigUpdate({} as any);
        expect(restartSpy).toHaveBeenCalledTimes(1);
    });

    it('a config save does not restart the maximum delay clock', async () => {
        build({ onlyWhenEmpty: true, maxRestartDelayMinutes: 3 });
        players.count = 3;
        await tick(); //delayed at 12:00:30
        await tick(2); //12:02:30
        scheduler.handleConfigUpdate({} as any);
        expect(scheduler.getStatus().nextIsDelayed).toBe(true);
        await tick(); //12:03:30 -> 3 minutes since the first attempt
        expect(restartSpy).toHaveBeenCalledTimes(1);
    });

    it('drops the delayed restart when its time is no longer in the schedule', async () => {
        build({ onlyWhenEmpty: true, maxRestartDelayMinutes: 30 });
        players.count = 3;
        await tick();
        txConfig.restarter.schedule = ['18:00'];
        scheduler.handleConfigUpdate({} as any);
        expect(scheduler.getStatus().nextIsDelayed).toBe(false);
        players.count = 0;
        await tick();
        expect(restartSpy).not.toHaveBeenCalled();
    });

    it('drops a delayed temporary restart on a config save, like it drops any temporary schedule', async () => {
        build({ onlyWhenEmpty: true, maxRestartDelayMinutes: 30 });
        scheduler.setNextTempSchedule('12:00'); //same time as the configured one
        players.count = 3;
        await tick();
        await tick(2);
        expect(scheduler.getStatus().nextIsDelayed).toBe(true);
        scheduler.handleConfigUpdate({} as any);
        expect(scheduler.getStatus().nextIsDelayed).toBe(false);
        expect(scheduler.getStatus().nextIsTemp).toBe(false);
    });

    it('does not restart twice in the same minute when another slot lands on it', async () => {
        build({ onlyWhenEmpty: true, maxRestartDelayMinutes: 30 });
        txConfig.restarter.schedule = ['12:00', '12:05'];
        players.count = 3;
        await tick(); //12:00:30, delayed
        players.count = 0;
        vi.setSystemTime(new Date(2026, 9, 29, 12, 5, 10));
        await scheduler.checkSchedule(); //releases the delayed restart
        expect(restartSpy).toHaveBeenCalledTimes(1);
        scheduler.handleConfigUpdate({} as any); //admin saves a setting in the same minute
        await scheduler.checkSchedule();
        expect(restartSpy).toHaveBeenCalledTimes(1);
    });

    it('cancelling a delayed restart really cancels it, even in the same minute', async () => {
        build({ onlyWhenEmpty: true, maxRestartDelayMinutes: 30 });
        players.count = 3;
        await tick();
        scheduler.setNextSkip(true, 'admin');
        players.count = 0;
        await scheduler.checkSchedule();
        expect(restartSpy).not.toHaveBeenCalled();
        expect(scheduler.getStatus().nextIsDelayed).toBe(false);
    });

    it('refuses a temporary schedule while a restart is waiting for players', async () => {
        build({ onlyWhenEmpty: true, maxRestartDelayMinutes: 30 });
        players.count = 3;
        await tick();
        expect(() => scheduler.setNextTempSchedule('+10')).toThrow('delayed');
    });

    it('skips the scheduled restart while the server is still in its boot grace period', async () => {
        build({ onlyWhenEmpty: false, maxRestartDelayMinutes: 30 });
        txConfig.restarter.bootGracePeriod = 45;
        txCore.fxRunner.child.uptime = 10_000;
        await tick();
        expect(restartSpy).not.toHaveBeenCalled();
    });

    it('forgets the delayed restart when the server closes', async () => {
        build({ onlyWhenEmpty: true, maxRestartDelayMinutes: 30 });
        players.count = 4;
        await tick();
        expect(scheduler.getStatus().nextIsDelayed).toBe(true);
        scheduler.handleServerClose();
        expect(scheduler.getStatus().nextIsDelayed).toBe(false);
    });
});
