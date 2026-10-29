//@ts-nocheck
import { suite, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import FXServerDownloadLog from './downloadLog';


suite('FXServerDownloadLog', () => {
    let tmpDir: string;
    let ctx: any;
    beforeEach(async () => {
        tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tx-downloadlog-'));
        vi.stubGlobal('txCore', { logger: { fxserver: { activeFilePath: path.join(tmpDir, 'fxserver.log') } } });
        ctx = {
            admin: { name: 'admin', testPermission: () => true },
            utils: { renderMessage: vi.fn() },
            attachment: vi.fn(),
            body: undefined,
        };
    });
    afterEach(async () => {
        vi.unstubAllGlobals();
        await fsp.rm(tmpDir, { recursive: true, force: true });
    });

    it('streams the active log file instead of loading it in memory', async () => {
        await fsp.writeFile(path.join(tmpDir, 'fxserver.log'), 'line1\nline2\n');
        await FXServerDownloadLog(ctx);
        expect(ctx.body).toBeInstanceOf(Readable);
        const chunks: Buffer[] = [];
        for await (const chunk of ctx.body) chunks.push(chunk);
        expect(Buffer.concat(chunks).toString()).toBe('line1\nline2\n');
        expect(ctx.attachment).toHaveBeenCalledTimes(1);
    });

    it('shows an error instead of an empty download when the log is missing', async () => {
        await FXServerDownloadLog(ctx);
        expect(ctx.utils.renderMessage).toHaveBeenCalledTimes(1);
        expect(ctx.attachment).not.toHaveBeenCalled();
        expect(ctx.body).toBeUndefined();
    });

    it('refuses admins without console.view', async () => {
        ctx.admin.testPermission = () => false;
        await FXServerDownloadLog(ctx);
        expect(ctx.utils.renderMessage).toHaveBeenCalledTimes(1);
        expect(ctx.attachment).not.toHaveBeenCalled();
    });
});
