const modulename = 'FxPlayerPositions';
import { z } from 'zod';
import consoleFactory from '@lib/console';
import type { PlayerMapEntryType, PlayerMapEventType } from '@shared/socketioTypes';
const console = consoleFactory(modulename);


//Consts
const MAX_PLAYERS = 4096; //netids go up to 65535, but no server has that many at once
const MAX_COORD = 20_000; //the GTA V map is about 12k wide
const STALE_MS = 15_000; //positions come every 1.5 to 5 seconds
const ASK_INTERVAL_MS = 5_000;
const ASK_TTL_MS = 20_000; //4 intervals, the server stops reporting if it is not asked again

const coordSchema = z.number().finite().min(-MAX_COORD).max(MAX_COORD);
const reportSchema = z.object({
    type: z.literal('txAdminPlayerPositions'),
    players: z.array(z.tuple([
        z.number().int().min(0).max(65535), //netid
        coordSchema, //x
        coordSchema, //y
        z.number().int().min(-1).max(8), //vehicle type, see sv_playerlist.lua
    ])).max(MAX_PLAYERS),
});


/**
 * Holds the last positions of all players, reported by the server resource (OneSync only), and
 * relays them to the `playermap` websocket room. The resource only reports while someone is on
 * the map, because this module asks for it: it keeps asking every 5s while the room has a member.
 */
export default class FxPlayerPositions {
    #entries: PlayerMapEntryType[] = [];
    #ts = 0;

    constructor() {
        setInterval(() => {
            if (!txCore.fxRunner.child?.isAlive) return;
            if (txCore.webServer.webSocket.getRoomSize('playermap') < 1) return;
            txCore.fxRunner.sendEvent('playerPositionsWanted', { ttlMs: ASK_TTL_MS });
        }, ASK_INTERVAL_MS);
    }


    /**
     * Handles a `txAdminPlayerPositions` report from the server resource.
     * An invalid report is ignored as a whole, so the map never shows half of something.
     */
    handleReport(payload: unknown) {
        const validation = reportSchema.safeParse(payload);
        if (!validation.success) {
            console.verbose.warn('Invalid txAdminPlayerPositions payload:');
            console.verbose.dir(validation.error.errors.slice(0, 3));
            return;
        }

        //Last entry wins for a repeated netid, and the entries are copied
        const byNetid = new Map<number, PlayerMapEntryType>();
        for (const [netid, x, y, vType] of validation.data.players) {
            byNetid.delete(netid);
            byNetid.set(netid, [netid, x, y, vType]);
        }
        this.#entries = [...byNetid.values()];
        this.#ts = Date.now();
        txCore.webServer.webSocket.pushRefresh('playermap');
    }


    /**
     * Forgets everything, as the players are gone with the server.
     */
    handleServerClose() {
        this.#entries = [];
        this.#ts = 0;
        txCore.webServer.webSocket.pushRefresh('playermap');
    }


    /**
     * Data of the `playermap` room: the last report, or no players if it is too old.
     */
    getRoomData(): PlayerMapEventType {
        const isFresh = this.#ts > 0 && Date.now() - this.#ts <= STALE_MS;
        return {
            mutex: txCore.fxRunner.child?.mutex ?? null,
            onesync: txConfig.server.onesync,
            ts: this.#ts,
            players: isFresh ? this.#entries : [],
        };
    }
}
