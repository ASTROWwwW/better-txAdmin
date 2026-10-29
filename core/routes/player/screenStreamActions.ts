const modulename = 'WebServer:PlayerScreenStream';
import consoleFactory from '@lib/console';
import { ServerPlayer } from '@lib/player/playerClasses.js';
import { ScreenStreamError, type ScreenStreamErrorCode } from '@modules/FxScreenStreams';
import type { AuthedCtx } from '@modules/WebServer/ctxTypes';
import type { ApiPlayerScreenStreamStartResp, ApiPlayerScreenStreamStatusResp } from '@shared/playerApiTypes';
import type { GenericApiResp } from '@shared/genericApiTypes';
const console = consoleFactory(modulename);

const ERROR_MESSAGES: Record<ScreenStreamErrorCode, string> = {
    server_offline: 'The server is not running.',
    player_gone: 'This player is not online anymore.',
    busy: 'Another admin is already watching this player.',
    too_many: 'Too many live views are open right now, close one first.',
    not_found: 'This live view does not exist anymore.',
};
const NO_PERMISSION = {
    error: 'You don\'t have permission to execute this action.',
    code: 'no_permission',
};
const NOT_FOUND = { error: ERROR_MESSAGES.not_found, code: 'not_found' };

const numberOrUndefined = (value: unknown) => (typeof value === 'number' ? value : undefined);


/**
 * Starts the smooth live view. The image itself is served by the screenStream view route.
 * Seeing a player's screen needs the same permission as spectating them.
 */
export const handleScreenStreamStart = async (ctx: AuthedCtx, player: unknown): Promise<ApiPlayerScreenStreamStartResp> => {
    if (!ctx.admin.testPermission('players.spectate', modulename)) return NO_PERMISSION;
    if (!(player instanceof ServerPlayer) || !player.isConnected) {
        return { error: ERROR_MESSAGES.player_gone, code: 'player_gone' };
    }

    try {
        const body = ctx.request.body;
        return txCore.fxScreenStreams.start(ctx.admin.name, player, {
            fps: numberOrUndefined(body?.fps),
            width: numberOrUndefined(body?.width),
            quality: numberOrUndefined(body?.quality),
        });
    } catch (error) {
        if (error instanceof ScreenStreamError) {
            return { error: ERROR_MESSAGES[error.code], code: error.code };
        }
        console.verbose.error(`Unexpected error while starting a live view: ${(error as Error).message}`);
        return { error: 'Failed to start the live view.', code: 'unknown' };
    }
};


/**
 * Only the session id is needed, the player may be gone already.
 */
const withSession = async <T>(ctx: AuthedCtx, run: (sessionId: string) => T): Promise<T | typeof NO_PERMISSION | typeof NOT_FOUND> => {
    if (!ctx.admin.testPermission('players.spectate', modulename)) return NO_PERMISSION;
    const sessionId = ctx.request.body?.sessionId;
    if (typeof sessionId !== 'string' || !sessionId.length) return NOT_FOUND;
    try {
        return run(sessionId);
    } catch (error) {
        if (error instanceof ScreenStreamError) {
            return { error: ERROR_MESSAGES[error.code], code: error.code };
        }
        console.verbose.error(`Unexpected error in a live view action: ${(error as Error).message}`);
        return { error: 'Failed to reach the live view.', code: 'unknown' };
    }
};


/**
 * The panel closed the viewer.
 */
export const handleScreenStreamStop = async (ctx: AuthedCtx): Promise<GenericApiResp> => {
    return withSession(ctx, (sessionId) => {
        txCore.fxScreenStreams.stop(ctx.admin.name, sessionId);
        return { success: true } as const;
    }) as Promise<GenericApiResp>;
};


/**
 * Asked every second or so by the panel while the image runs.
 */
export const handleScreenStreamStatus = async (ctx: AuthedCtx): Promise<ApiPlayerScreenStreamStatusResp> => {
    return withSession(ctx, (sessionId) => {
        return txCore.fxScreenStreams.getStatus(sessionId, ctx.admin.name);
    }) as Promise<ApiPlayerScreenStreamStatusResp>;
};
