import type { RoomType } from "../webSocket";


/**
 * The live map of the web panel. Only the latest positions matter, so the buffer is not cumulative:
 * each report replaces the previous one before the 250ms flush.
 * Seeing where every player is needs the same permission as spectating them.
 */
export default {
    permission: 'players.spectate',
    eventName: 'playermap',
    cumulativeBuffer: false,
    outBuffer: null,
    initialData: () => {
        return txCore.fxPlayerPositions.getRoomData();
    },
} satisfies RoomType;
