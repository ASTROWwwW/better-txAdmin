const modulename = 'WebServer:PlayerScreenshot';
import consoleFactory from '@lib/console';
import { ServerPlayer } from '@lib/player/playerClasses.js';
import { ScreenshotError, type ScreenshotErrorCode } from '@modules/FxScreenshots';
import type { AuthedCtx } from '@modules/WebServer/ctxTypes';
import type { ApiPlayerScreenshotResp } from '@shared/playerApiTypes';
import type { GenericApiResp } from '@shared/genericApiTypes';
const console = consoleFactory(modulename);

const ERROR_MESSAGES: Record<ScreenshotErrorCode, string> = {
    player_gone: 'This player is not online anymore.',
    server_offline: 'The server is not running.',
    server_closed: 'The server is not running.',
    busy: 'Asked too often, try again.',
    too_fast: 'Asked too often, try again.',
    too_many: 'Too many screenshots are being taken right now, try again.',
    timeout: 'The player did not answer in time.',
    session_expired: 'The viewing session ended after 10 minutes.',
    screenshot_basic_missing: 'The screenshot-basic resource is not started on this server.',
    capture_failed: 'The player\'s game could not take the screenshot.',
    invalid_image: 'The player sent an invalid image.',
};
const NO_PERMISSION: ApiPlayerScreenshotResp = {
    error: 'You don\'t have permission to execute this action.',
    code: 'no_permission',
};


/**
 * One screenshot of the player's game screen. The panel asks again and again while its viewer is open.
 * Seeing a player's screen needs the same permission as spectating them.
 */
export const handleScreenshot = async (ctx: AuthedCtx, player: unknown): Promise<ApiPlayerScreenshotResp> => {
    if (!ctx.admin.testPermission('players.spectate', modulename)) return NO_PERMISSION;
    if (!(player instanceof ServerPlayer) || !player.isConnected) {
        return { error: ERROR_MESSAGES.player_gone, code: 'player_gone' };
    }

    try {
        const renew = ctx.request.body?.renew === true;
        return await txCore.fxScreenshots.capture(ctx.admin.name, player, { renew });
    } catch (error) {
        if (error instanceof ScreenshotError) {
            return { error: ERROR_MESSAGES[error.code], code: error.code };
        }
        console.verbose.error(`Unexpected error while taking a screenshot: ${(error as Error).message}`);
        return { error: 'Failed to take the screenshot.', code: 'unknown' };
    }
};


/**
 * The panel closed the viewer.
 */
export const handleScreenshotStop = async (ctx: AuthedCtx, player: unknown): Promise<GenericApiResp | ApiPlayerScreenshotResp> => {
    if (!ctx.admin.testPermission('players.spectate', modulename)) return NO_PERMISSION;
    if (!(player instanceof ServerPlayer)) return { error: ERROR_MESSAGES.player_gone, code: 'player_gone' };
    txCore.fxScreenshots.stopViewing(ctx.admin.name, player.netid);
    return { success: true };
};
