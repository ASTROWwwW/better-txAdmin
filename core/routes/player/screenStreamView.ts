const modulename = 'WebServer:PlayerScreenStreamView';
import consoleFactory from '@lib/console';
import { ScreenStreamError } from '@modules/FxScreenStreams';
import { normalAuthLogic } from '@modules/WebServer/authLogic';
import type { InitializedCtx } from '@modules/WebServer/ctxTypes';
const console = consoleFactory(modulename);


/**
 * The live view of a player's game screen, as an image that never ends (multipart/x-mixed-replace),
 * for an <img> in the panel. An <img> cannot send the CSRF header the API routes need, so this route uses the
 * session cookie and a secret view token only given in the answer of the (CSRF protected) start action,
 * which a page of another site cannot read.
 * Only the admin that started the stream can watch it, and only while they keep the permission.
 */
export default async function ScreenStreamView(ctx: InitializedCtx) {
    const sessionId = (ctx as any).params?.sessionId;
    const viewToken = ctx.query.t; //an array when repeated, which is refused
    if (typeof sessionId !== 'string' || typeof viewToken !== 'string') {
        return ctx.utils.error(404, 'Not Found');
    }

    //Cookie session only, the x-txadmin-token (nui) header does not apply to images
    const authResult = normalAuthLogic(ctx.sessTools);
    if (!authResult.success || !authResult.admin.testPermission('players.spectate', modulename)) {
        return ctx.utils.error(403, 'Forbidden');
    }

    //The session middleware refreshes the cookie in a `finally` that runs when this function first yields,
    //and a cookie cannot be set once the headers are written, so the response only starts after that.
    await new Promise((resolve) => setImmediate(resolve));

    try {
        txCore.fxScreenStreams.attachViewer(sessionId, viewToken, authResult.admin.name, ctx.res);
    } catch (error) {
        if (!(error instanceof ScreenStreamError)) {
            console.verbose.error(`Unexpected error while attaching a live view: ${(error as Error).message}`);
        }
        return ctx.utils.error(404, 'Not Found');
    }

    //The response is written by the stream manager from now on, this route returns so that it is not
    //cut by the route timeout of the top level middleware.
    ctx.respond = false;
    ctx.body = null; //headers are already sent so this changes nothing, but avoids "route without output"
};
