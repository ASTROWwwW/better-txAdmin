const modulename = 'FxScreenshots';
import { randomBytes } from 'node:crypto';
import consoleFactory from '@lib/console';
import { isSafeImage } from '@lib/imageSize';
const console = consoleFactory(modulename);


//Consts
const REQUEST_TIMEOUT_MS = 8_000;
const MIN_INTERVAL_MS = 1_000; //between two captures of the same player
const MAX_PENDING = 5;
const MAX_PENDING_PER_ADMIN = 2; //so one admin cannot take all the places
const SESSION_GAP_MS = 15_000; //no capture for this long ends a viewing session
const SESSION_MAX_MS = 10 * 60_000; //then the admin has to choose to keep watching
const CLEANUP_INTERVAL_MS = 5_000;
const FRAME_KEPT_MS = 5_000; //a frame is kept to hand it out again for MIN_INTERVAL_MS, this is when it is forgotten
const MAX_IMAGE_CHARS = 600_000; //the http body limit of the web server is 768kb
const SCREENSHOT_QUALITY = 0.4;
const IMAGE_REGEX = /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;
const PASSED_ON_ERRORS = ['screenshot_basic_missing', 'player_gone', 'capture_failed'];


//Types
export type ScreenshotErrorCode =
    | 'player_gone' | 'server_offline' | 'server_closed' | 'busy' | 'too_fast' | 'too_many' | 'timeout'
    | 'session_expired' | 'screenshot_basic_missing' | 'capture_failed' | 'invalid_image';
export class ScreenshotError extends Error {
    constructor(public readonly code: ScreenshotErrorCode) {
        super(code);
        this.name = 'ScreenshotError';
    }
}
type CapturePlayer = { netid: number; displayName: string; isConnected: boolean };
type Frame = { image: string; ts: number };
type Pending = {
    netid: number;
    adminName: string; //who asked, the others that want the same player share the answer
    resolve: (frame: Frame) => void;
    reject: (error: ScreenshotError) => void;
    timer: ReturnType<typeof setTimeout>;
};
type Session = {
    adminName: string;
    netid: number;
    displayName: string;
    since: number;
    lastActivity: number;
    frames: number;
    expired: boolean; //kept so the same admin cannot silently start over, until nobody asks for a while
};


/**
 * Asks the server resource for one screenshot of a player's game screen, which it takes with the
 * `screenshot-basic` resource, and waits for it to come back through the intercom route.
 * An admin that keeps asking is a viewing session: it is written to the admin log when it starts and
 * when it stops, it ends after 10 minutes unless the admin renews it (starting again is logged too), and a
 * player is captured at most once a second: other admins that want the same player share the capture that is
 * on its way, or the frame that just came back.
 *
 * NOTE: the image is taken and sent by the player's game client, so a modified client can send anything.
 * That is why it is checked strictly here (a jpeg or png data URI, base64 only, size capped), and why
 * it is only ever shown as an image, never treated as evidence of what the player does.
 */
export default class FxScreenshots {
    #pending = new Map<string, Pending>();
    #inFlight = new Map<number, Promise<Frame>>(); //per player, the capture that is on its way
    #lastFrame = new Map<number, { frame: Frame; at: number }>();
    #lastRequestByNetid = new Map<number, number>();
    #sessions = new Map<string, Session>();

    constructor() {
        setInterval(() => this.#closeIdleSessions(), CLEANUP_INTERVAL_MS);
    }


    /**
     * Takes one screenshot of the player. Rejects with a ScreenshotError.
     * `renew` starts a new viewing session when the previous one reached its 10 minutes.
     */
    capture(adminName: string, player: CapturePlayer, options: { renew?: boolean } = {}) {
        const now = Date.now();
        if (!txCore.fxRunner.child?.isAlive) return Promise.reject(new ScreenshotError('server_offline'));
        if (!player.isConnected) return Promise.reject(new ScreenshotError('player_gone'));

        //Viewing session: refused once it is over, until the admin renews it
        const key = `${adminName}#${player.netid}`;
        let session = this.#sessions.get(key);
        if (session && !session.expired && now - session.since >= SESSION_MAX_MS) {
            this.#endSession(session, 'time limit');
        }
        if (session?.expired) {
            if (!options.renew) {
                session.lastActivity = now;
                return Promise.reject(new ScreenshotError('session_expired'));
            }
            this.#sessions.delete(key);
            session = undefined;
        }

        //Someone else already asked for this player: share their capture, or the frame that just came back
        const shared = this.#inFlight.get(player.netid);
        const recent = this.#lastFrame.get(player.netid);
        const canShare = shared !== undefined || (recent !== undefined && now - recent.at < MIN_INTERVAL_MS);
        if (!canShare) {
            const pendingOfAdmin = [...this.#pending.values()].filter((p) => p.adminName === adminName).length;
            if (now - (this.#lastRequestByNetid.get(player.netid) ?? 0) < MIN_INTERVAL_MS) {
                return Promise.reject(new ScreenshotError('too_fast'));
            }
            if (this.#pending.size >= MAX_PENDING || pendingOfAdmin >= MAX_PENDING_PER_ADMIN) {
                return Promise.reject(new ScreenshotError('too_many'));
            }
        }

        if (!session) {
            session = {
                adminName,
                netid: player.netid,
                displayName: player.displayName,
                since: now,
                lastActivity: now,
                frames: 0,
                expired: false,
            };
            this.#sessions.set(key, session);
            txCore.logger.admin.write(adminName, `Started viewing the screen of #${player.netid} (${player.displayName}).`);
        }
        session.lastActivity = now;

        const viewing = session;
        const counted = (frame: Frame) => {
            viewing.frames++;
            return frame;
        };
        if (shared) return shared.then(counted);
        if (canShare && recent) return Promise.resolve(counted(recent.frame));
        return this.#request(adminName, player.netid).then(counted);
    }


    /**
     * Asks the server for a screenshot, the same one for everybody that wants this player until it is answered.
     */
    #request(adminName: string, netid: number) {
        const promise = new Promise<Frame>((resolve, reject) => {
            const reqId = randomBytes(12).toString('base64url');
            const timer = setTimeout(() => {
                this.#pending.delete(reqId);
                reject(new ScreenshotError('timeout'));
            }, REQUEST_TIMEOUT_MS);
            this.#pending.set(reqId, { netid, adminName, resolve, reject, timer });
            this.#lastRequestByNetid.set(netid, Date.now());
            const sent = txCore.fxRunner.sendEvent('screenshotRequested', {
                reqId,
                netid,
                quality: SCREENSHOT_QUALITY,
            });
            if (!sent) this.#settle(reqId)?.reject(new ScreenshotError('server_offline'));
        });
        this.#inFlight.set(netid, promise);
        const done = () => {
            if (this.#inFlight.get(netid) === promise) this.#inFlight.delete(netid);
        };
        promise.then(done, done);
        return promise;
    }


    /**
     * Handles what the server resource sends back to the intercom route.
     * Anything that is not an answer to a request still waiting is ignored.
     */
    handleResult(payload: any) {
        const reqId = typeof payload?.reqId === 'string' ? payload.reqId : '';
        const pending = this.#settle(reqId);
        if (!pending) return;

        if (payload.error !== undefined && payload.error !== null) {
            const code = PASSED_ON_ERRORS.includes(payload.error) ? payload.error : 'capture_failed';
            return pending.reject(new ScreenshotError(code));
        }
        const image = payload.image;
        if (
            typeof image !== 'string'
            || image.length > MAX_IMAGE_CHARS
            || !IMAGE_REGEX.test(image)
            || !isSafeImage(Buffer.from(image.slice(image.indexOf(',') + 1), 'base64'))
        ) {
            console.verbose.warn('Discarded an invalid screenshot from the server.');
            return pending.reject(new ScreenshotError('invalid_image'));
        }
        const frame = { image, ts: Date.now() };
        this.#lastFrame.set(pending.netid, { frame, at: frame.ts });
        pending.resolve(frame);
    }


    /**
     * The admin closed the viewer.
     */
    stopViewing(adminName: string, netid: number) {
        const session = this.#sessions.get(`${adminName}#${netid}`);
        if (session && !session.expired) this.#endSession(session, 'closed');
        this.#sessions.delete(`${adminName}#${netid}`);
    }


    /**
     * The players are gone with the server.
     */
    handleServerClose() {
        for (const reqId of [...this.#pending.keys()]) {
            this.#settle(reqId)?.reject(new ScreenshotError('server_closed'));
        }
        for (const session of this.#sessions.values()) {
            if (!session.expired) this.#endSession(session, 'server closed');
        }
        this.#sessions.clear();
        this.#lastRequestByNetid.clear();
        this.#lastFrame.clear();
        this.#inFlight.clear();
    }


    /**
     * txAdmin is stopping: the sessions that are open get their line in the log, so there is no start without a stop.
     */
    handleShutdown() {
        for (const session of this.#sessions.values()) {
            if (!session.expired) this.#endSession(session, 'txAdmin shut down');
        }
        this.#sessions.clear();
    }


    #settle(reqId: string) {
        const pending = this.#pending.get(reqId);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#pending.delete(reqId);
        return pending;
    }


    #endSession(session: Session, why: string) {
        session.expired = true;
        const seconds = Math.round((Date.now() - session.since) / 1000);
        txCore.logger.admin.write(
            session.adminName,
            `Stopped viewing the screen of #${session.netid} (${session.displayName}) after ${session.frames} frames, ${seconds}s (${why}).`,
        );
    }


    #closeIdleSessions() {
        const now = Date.now();
        for (const [netid, last] of this.#lastFrame) {
            if (now - last.at > FRAME_KEPT_MS) this.#lastFrame.delete(netid);
        }
        for (const [key, session] of this.#sessions) {
            if (now - session.lastActivity <= SESSION_GAP_MS) continue;
            if (!session.expired) this.#endSession(session, 'no more frames asked');
            this.#sessions.delete(key);
        }
    }
}
