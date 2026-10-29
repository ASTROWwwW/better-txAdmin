const modulename = 'FxScreenStreams';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import consoleFactory from '@lib/console';
import { getImageSize, isSafeImage } from '@lib/imageSize';
const console = consoleFactory(modulename);


//Consts
const MAX_SESSIONS = 3;
const MAX_VIEWERS = 3; //browser tabs of the same admin on one stream
const SESSION_MAX_MS = 10 * 60_000;
const NO_VIEWER_MS = 15_000;
const FIRST_FRAME_MS = 12_000;
const STALLED_MS = 20_000; //a stream that was running and stopped sending (player left, game closed)
const ENDED_KEPT_MS = 60_000; //so the panel can still read why it ended
const MIN_FRAME_GAP_MS = 30; //more than ~30 frames a second is dropped
const MAX_FRAME_CHARS = 400_000; //base64, the intercom body limit is 768kb
const FPS_WINDOW_MS = 3_000;
const CHECK_INTERVAL_MS = 1_000;
const BOUNDARY = 'txframe';
const BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;

const FPS = { min: 5, max: 20, default: 12 };
const WIDTH = { min: 320, max: 1280, default: 640 };
const QUALITY = { min: 0.2, max: 0.8, default: 0.5 };


//Types
export type ScreenStreamErrorCode = 'server_offline' | 'player_gone' | 'busy' | 'too_many' | 'not_found';
export class ScreenStreamError extends Error {
    constructor(public readonly code: ScreenStreamErrorCode) {
        super(code);
        this.name = 'ScreenStreamError';
    }
}
export type ScreenStreamEndReason =
    | 'closed' | 'replaced' | 'no_viewer' | 'time_limit' | 'failed_to_start' | 'stalled' | 'revoked' | 'server_closed' | 'shutdown';
type StreamPlayer = { netid: number; displayName: string; isConnected: boolean };
type StreamViewerRes = Pick<ServerResponse, 'writeHead' | 'write' | 'end' | 'on'> & { writableNeedDrain?: boolean };
type Session = {
    id: string;
    token: string; //what the player uses to upload
    viewToken: string; //what the admin's browser uses to watch, never sent to the player
    adminName: string;
    netid: number;
    displayName: string;
    since: number;
    lastFrameAt: number;
    frameTimes: number[];
    frames: number;
    bytes: number;
    dropped: number;
    viewers: Set<StreamViewerRes>;
    noViewerSince: number | undefined;
    endedAt: number | undefined;
    endReason: ScreenStreamEndReason | undefined;
};


const clampSetting = (value: unknown, range: { min: number; max: number; default: number }) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return range.default;
    return Math.min(range.max, Math.max(range.min, value));
};

const safeEqual = (a: string, b: string) => {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

const isJpeg = (data: Buffer) => (
    data.length > 4
    && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
    && data[data.length - 2] === 0xff && data[data.length - 1] === 0xd9
);


/**
 * Live view of a player's game screen: the player's game sends small jpeg frames in a loop (through the server
 * resource, to the intercom route), and this module shows them to one admin as a motion jpeg stream.
 *
 * Every stream is logged when it starts and ends, is capped at 10 minutes, needs a viewer (it stops 15s after
 * the last one leaves), and there are at most 3 at once and one per player.
 *
 * NOTE: the frames are made by the player's game client, a modified client can send anything. They are only
 * relayed when they are real jpeg bytes, with `nosniff`, and are never treated as proof of what the player does.
 */
export default class FxScreenStreams {
    #sessions = new Map<string, Session>();

    constructor() {
        setInterval(() => this.#check(), CHECK_INTERVAL_MS);
    }


    /**
     * Starts a stream and asks the server resource to make the player's game send frames.
     * An earlier stream of the same admin on the same player is replaced.
     */
    start(adminName: string, player: StreamPlayer, options: { fps?: unknown; width?: unknown; quality?: unknown } = {}) {
        if (!txCore.fxRunner.child?.isAlive) throw new ScreenStreamError('server_offline');
        if (!player.isConnected) throw new ScreenStreamError('player_gone');

        const existing = [...this.#sessions.values()].find((s) => !s.endedAt && s.netid === player.netid);
        if (existing) {
            if (existing.adminName !== adminName) throw new ScreenStreamError('busy');
            this.#end(existing, 'replaced');
        }
        const active = [...this.#sessions.values()].filter((s) => !s.endedAt).length;
        if (active >= MAX_SESSIONS) throw new ScreenStreamError('too_many');

        const fps = clampSetting(options.fps, FPS);
        const width = Math.round(clampSetting(options.width, WIDTH));
        const quality = clampSetting(options.quality, QUALITY);
        const session: Session = {
            id: randomBytes(18).toString('base64url'),
            token: randomBytes(18).toString('base64url'),
            viewToken: randomBytes(18).toString('base64url'),
            adminName,
            netid: player.netid,
            displayName: player.displayName,
            since: Date.now(),
            lastFrameAt: 0,
            frameTimes: [],
            frames: 0,
            bytes: 0,
            dropped: 0,
            viewers: new Set(),
            noViewerSince: Date.now(),
            endedAt: undefined,
            endReason: undefined,
        };
        this.#sessions.set(session.id, session);
        txCore.logger.admin.write(adminName, `Started viewing the live screen of #${player.netid} (${player.displayName}).`);
        txCore.fxRunner.sendEvent('screenStreamStart', {
            sessionId: session.id,
            token: session.token,
            netid: player.netid,
            fps,
            width,
            quality,
            ttlMs: SESSION_MAX_MS + 30_000,
        });
        return { sessionId: session.id, viewToken: session.viewToken, fps, width, quality };
    }


    /**
     * A frame from the player (base64 jpeg), through the server resource.
     * The answer goes back to the player's game: it stops sending once told to.
     */
    handleFrame(sessionId: unknown, frame: unknown): { ok: true } | { stop: true } {
        const session = typeof sessionId === 'string' ? this.#sessions.get(sessionId) : undefined;
        if (!session || session.endedAt) return { stop: true };
        const now = Date.now();
        if (now - session.since >= SESSION_MAX_MS) {
            this.#end(session, 'time_limit');
            return { stop: true };
        }
        if (now - session.lastFrameAt < MIN_FRAME_GAP_MS) return { ok: true };

        if (typeof frame !== 'string' || frame.length > MAX_FRAME_CHARS || !BASE64_REGEX.test(frame)) {
            return { ok: true };
        }
        const jpeg = Buffer.from(frame, 'base64');
        if (!isJpeg(jpeg) || getImageSize(jpeg)?.type !== 'jpeg' || !isSafeImage(jpeg)) return { ok: true };

        session.lastFrameAt = now;
        session.frames++;
        session.bytes += jpeg.length;
        session.frameTimes.push(now);
        while (session.frameTimes.length && now - session.frameTimes[0] > FPS_WINDOW_MS) session.frameTimes.shift();

        const header = Buffer.from(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`, 'latin1');
        for (const res of session.viewers) {
            if (res.writableNeedDrain) {
                session.dropped++;
                continue;
            }
            res.write(header);
            res.write(jpeg);
            res.write('\r\n');
        }
        return { ok: true };
    }


    /**
     * Connects the admin's browser (an <img>) to the stream, as a multipart/x-mixed-replace response.
     * Returns a function that detaches the viewer. Throws not_found unless the session belongs to this admin
     * and the viewer token matches.
     */
    attachViewer(sessionId: string, viewToken: string, adminName: string, res: StreamViewerRes) {
        const session = this.#getOwned(sessionId, adminName);
        if (session.endedAt || typeof viewToken !== 'string' || !safeEqual(viewToken, session.viewToken)) {
            throw new ScreenStreamError('not_found');
        }
        if (session.viewers.size >= MAX_VIEWERS) throw new ScreenStreamError('too_many');

        res.writeHead(200, {
            'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'X-Content-Type-Options': 'nosniff',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive',
        });
        session.viewers.add(res);
        session.noViewerSince = undefined;
        const detach = () => {
            session.viewers.delete(res);
            if (!session.viewers.size && !session.endedAt) session.noViewerSince = Date.now();
        };
        res.on('close', detach);
        return detach;
    }


    /**
     * What the panel polls while the image streams.
     */
    getStatus(sessionId: string, adminName: string) {
        const session = this.#getOwned(sessionId, adminName);
        const now = Date.now();
        const span = session.frameTimes.length > 1
            ? session.frameTimes[session.frameTimes.length - 1] - session.frameTimes[0]
            : 0;
        return {
            state: session.endedAt ? 'ended' as const : session.frames ? 'live' as const : 'waiting' as const,
            reason: session.endReason,
            frames: session.frames,
            fps: span > 0 ? Math.round(((session.frameTimes.length - 1) / span) * 10_000) / 10 : 0,
            bytes: session.bytes,
            ageMs: (session.endedAt ?? now) - session.since,
        };
    }


    /**
     * The admin closed the viewer.
     */
    stop(adminName: string, sessionId: string) {
        const session = this.#getOwned(sessionId, adminName);
        if (!session.endedAt) this.#end(session, 'closed');
    }


    /**
     * The players are gone with the server.
     */
    handleServerClose() {
        for (const session of this.#sessions.values()) {
            if (!session.endedAt) this.#end(session, 'server_closed', false);
        }
    }


    /**
     * txAdmin is stopping: every open stream gets its line in the log, so there is never a start without a stop.
     */
    handleShutdown() {
        for (const session of this.#sessions.values()) {
            if (!session.endedAt) this.#end(session, 'shutdown', false);
        }
    }


    #getOwned(sessionId: string, adminName: string) {
        const session = typeof sessionId === 'string' ? this.#sessions.get(sessionId) : undefined;
        if (!session || session.adminName !== adminName) throw new ScreenStreamError('not_found');
        return session;
    }


    /**
     * The admin can be deleted or lose the permission while watching, like it is rechecked for websockets.
     */
    #adminMaySpectate(adminName: string) {
        const admin = txCore.adminStore.getAdminByName(adminName);
        if (!admin) return false;
        return admin.master === true
            || (Array.isArray(admin.permissions)
                && (admin.permissions.includes('all_permissions') || admin.permissions.includes('players.spectate')));
    }


    #end(session: Session, reason: ScreenStreamEndReason, tellServer = true) {
        session.endedAt = Date.now();
        session.endReason = reason;
        if (tellServer) txCore.fxRunner.sendEvent('screenStreamStop', { sessionId: session.id });
        for (const res of session.viewers) res.end();
        session.viewers.clear();

        const seconds = Math.max(1, Math.round((session.endedAt - session.since) / 1000));
        const avgFps = Math.round((session.frames / seconds) * 10) / 10;
        txCore.logger.admin.write(
            session.adminName,
            `Stopped viewing the live screen of #${session.netid} (${session.displayName}) after `
            + `${session.frames} frame${session.frames === 1 ? '' : 's'}, ${seconds}s, ${avgFps} fps (${reason}).`,
        );
    }


    #check() {
        const now = Date.now();
        for (const [id, session] of this.#sessions) {
            if (session.endedAt) {
                if (now - session.endedAt > ENDED_KEPT_MS) this.#sessions.delete(id);
                continue;
            }
            if (!this.#adminMaySpectate(session.adminName)) {
                this.#end(session, 'revoked');
            } else if (now - session.since >= SESSION_MAX_MS) {
                this.#end(session, 'time_limit');
            } else if (session.noViewerSince !== undefined && now - session.noViewerSince > NO_VIEWER_MS) {
                this.#end(session, 'no_viewer');
            } else if (!session.frames && session.viewers.size && now - session.since > FIRST_FRAME_MS) {
                this.#end(session, 'failed_to_start');
            } else if (session.frames && now - session.lastFrameAt > STALLED_MS) {
                this.#end(session, 'stalled');
            }
        }
    }
}
