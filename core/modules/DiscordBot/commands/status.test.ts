//@ts-nocheck
import { suite, it, expect, vi, beforeEach } from 'vitest';
import { generateStatusMessage } from './status';
import { FxMonitorHealth } from '@shared/enums';

const embedJson = JSON.stringify({ title: 'Server', description: '{{statusString}}' });

const stubRuntime = (whitelistMode: string, health = FxMonitorHealth.ONLINE, schedule: any = { nextRelativeMs: null }) => {
    vi.stubGlobal('txConfig', {
        general: { serverName: 'Test' },
        whitelist: { mode: whitelistMode },
        discordBot: { embedJson, embedConfigJson: '{}' },
    });
    vi.stubGlobal('txCore', {
        cacheStore: { get: () => 'abc123' },
        fxMonitor: { status: { health, uptime: 0 } },
        fxPlayerlist: { onlineCount: 0 },
        fxScheduler: { getStatus: () => schedule },
    });
};

suite('generateStatusMessage maintenance status', () => {
    beforeEach(() => {
        vi.unstubAllGlobals();
    });

    it('shows online while the server accepts everybody', () => {
        stubRuntime('disabled');
        const embed = generateStatusMessage(embedJson, '{}').embeds[0];
        expect(embed.data.description).toBe('🟢 Online');
    });

    it('shows maintenance when only admins can join', () => {
        stubRuntime('adminOnly');
        const embed = generateStatusMessage(embedJson, '{}').embeds[0];
        expect(embed.data.description).toBe('🟠 Maintenance');
    });

    it('uses the custom maintenance strings of the embed config', () => {
        stubRuntime('adminOnly');
        const config = JSON.stringify({ maintenanceString: '🛠️ Back soon', maintenanceColor: '#112233' });
        const embed = generateStatusMessage(embedJson, config).embeds[0];
        expect(embed.data.description).toBe('🛠️ Back soon');
        expect(embed.data.color).toBe(0x112233);
    });

    it('does not hide an offline server behind the maintenance label', () => {
        stubRuntime('adminOnly', FxMonitorHealth.OFFLINE);
        const embed = generateStatusMessage(embedJson, '{}').embeds[0];
        expect(embed.data.description).not.toBe('🟠 Maintenance');
    });

    it('does not say a delayed restart is happening right now', () => {
        stubRuntime('disabled', FxMonitorHealth.ONLINE, {
            nextRelativeMs: -120_000, nextSkip: false, nextIsTemp: false, nextIsDelayed: true,
        });
        const embedJsonNext = JSON.stringify({ title: 'Server', description: '{{nextScheduledRestart}}' });
        const embed = generateStatusMessage(embedJsonNext, '{}').embeds[0];
        expect(embed.data.description).toContain('delayed');
        expect(embed.data.description).not.toContain('right now');
    });
});
