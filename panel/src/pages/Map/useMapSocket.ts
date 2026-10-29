import { useEffect, useState } from 'react';
import { getSocket } from '@/lib/utils';
import type { PlayerMapEventType } from '@shared/socketioTypes';

/**
 * Joins the `playermap` room for as long as the page is mounted, which is also what tells the
 * core to ask the server for positions. Without the permission the room is simply never joined,
 * and `data` stays null.
 */
export default function useMapSocket() {
    const [data, setData] = useState<PlayerMapEventType | null>(null);
    const [isConnected, setIsConnected] = useState(false);

    useEffect(() => {
        const socket = getSocket(['playermap']);
        socket.on('connect', () => setIsConnected(true));
        socket.on('disconnect', () => setIsConnected(false));
        socket.on('playermap', (event: PlayerMapEventType) => setData(event));
        return () => {
            socket.removeAllListeners();
            socket.disconnect();
        };
    }, []);

    return { data, isConnected };
}
