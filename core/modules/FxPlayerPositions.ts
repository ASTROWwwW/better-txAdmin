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
const entrySchema = z.tuple([
    z.number().int().min(0).max(65535), //netid
    coordSchema, //x
    coordSchema, //y
    z.number().int().min(-1).max(8), //vehicle type, see sv_playerlist.lua
]);
//The entries are checked one by one: a player whose position is nonsense (a script can push a ped far outside
//the map, and the json of the server writes NaN as null) must not empty the map for everyone else
const reportSchema = z.object({
    type: z.literal('txAdminPlayerPositions'),
    players: z.array(z.unknown()).max(MAX_PLAYERS),
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
            this.#clearIfStale();
            if (!txCore.fxRunner.child?.isAlive) return;
            if (txCore.webServer.webSocket.getRoomSize('playermap') < 1) return;
            txCore.fxRunner.sendEvent('playerPositionsWanted', { ttlMs: ASK_TTL_MS });
        }, ASK_INTERVAL_MS);
    }


    /**
     * Handles a `txAdminPlayerPositions` report from the server resource.
     * A report that is not a report is ignored as a whole, and an entry that is not valid is dropped alone.
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
        let dropped = 0;
        for (const entry of validation.data.players) {
            const parsed = entrySchema.safeParse(entry);
            if (!parsed.success) {
                dropped++;
                continue;
            }
            const [netid, x, y, vType] = parsed.data;
            byNetid.delete(netid);
            byNetid.set(netid, [netid, x, y, vType]);
        }
        if (dropped) console.verbose.warn(`Dropped ${dropped} invalid entries of a txAdminPlayerPositions report.`);
        this.#entries = [...byNetid.values()];
        this.#ts = Date.now();
        txCore.webServer.webSocket.pushRefresh('playermap');
    }


    /**
     * The room only hears about new reports, so when they stop coming (the server hangs, or the resource keeps
     * failing) an open map would keep showing the last positions as if they were live.
     */
    #clearIfStale() {
        if (!this.#entries.length || Date.now() - this.#ts <= STALE_MS) return;
        this.#entries = [];
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
