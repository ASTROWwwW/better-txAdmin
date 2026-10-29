type PlayerRef = { mutex: string; netid: number } | { license: string };
type ModalPlayer = { netid?: number; isConnected: boolean };

/**
 * Which player the screen viewer asks about. A modal opened from the playerlist knows the server session
 * (mutex) of the player, one opened by license does not, but if that player is online right now they are on the
 * current one, which the core understands as 'current'.
 */
export const getScreenTarget = (playerRef: PlayerRef, player: ModalPlayer | undefined) => {
    if ('mutex' in playerRef) return { mutex: playerRef.mutex, netid: playerRef.netid };
    if (!player?.isConnected || !player.netid) return undefined;
    return { mutex: 'current', netid: player.netid };
};
