const modulename = 'WebServer:FXServerDownloadLog';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import consoleFactory from '@lib/console';
const console = consoleFactory(modulename);


/**
 * Returns the console log file
 * @param {import('@modules/WebServer/ctxTypes').AuthedCtx} ctx
 */
export default async function FXServerDownloadLog(ctx) {
    //Check permissions
    if (!ctx.admin.testPermission('console.view', modulename)) {
        return ctx.utils.renderMessage('You don\'t have permission to download this log.');
    }

    const logPath = txCore.logger.fxserver.activeFilePath;
    try {
        await fsp.access(logPath, fs.constants.R_OK);
    } catch (error) {
        console.error(`Could not read log file ${logPath}.`);
        return ctx.utils.renderMessage('The log file could not be read.');
    }
    const now = (new Date() / 1000).toFixed();
    ctx.attachment(`fxserver_${now}.log`);
    ctx.body = fs.createReadStream(logPath);
    console.log(`[${ctx.admin.name}] Downloading console log file.`);
};
