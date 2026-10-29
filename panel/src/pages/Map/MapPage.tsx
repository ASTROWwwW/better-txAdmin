import { useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { MapPinOffIcon } from 'lucide-react';
import { playerlistAtom } from '@/hooks/playerlist';
import { useOpenPlayerModal } from '@/hooks/playerModal';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import MapView, { type MapPlayer } from './MapView';
import useMapSocket from './useMapSocket';


/**
 * The live map: where every player is, refreshed every few seconds while the page is open.
 * Needs OneSync, as the server only knows the positions with it.
 */
export default function MapPage() {
    const { data, isConnected } = useMapSocket();
    const playerlist = useAtomValue(playerlistAtom);
    const openPlayerModal = useOpenPlayerModal();
    const [selectedNetids, setSelectedNetids] = useState<number[] | null>(null);

    const namesByNetid = useMemo(
        () => new Map(playerlist.map((p) => [p.netid, p.displayName])),
        [playerlist],
    );
    const players = useMemo<MapPlayer[]>(() => {
        return (data?.players ?? []).map(([netid, x, y]) => ({
            netid,
            x,
            y,
            label: namesByNetid.get(netid) ?? 'unknown',
        }));
    }, [data, namesByNetid]);

    const openPlayer = (netid: number) => {
        if (!data?.mutex) return;
        openPlayerModal({ mutex: data.mutex, netid });
    };

    const isOneSyncOff = data?.onesync === 'off';
    const isWaiting = !isOneSyncOff && data !== null && players.length === 0;

    return (
        <div className="flex flex-col w-full h-contentvh min-h-[420px] gap-3 p-1">
            <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-2xl font-bold tracking-tight">Live Map</h2>
                <span className="text-sm text-muted-foreground">
                    {!isConnected
                        ? 'connecting...'
                        : isOneSyncOff
                            ? 'OneSync is off'
                            : `${players.length} of ${playerlist.length} players with a position`}
                </span>
            </div>

            <div className="relative flex-1 min-h-0">
                {isOneSyncOff ? (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-card/90 text-center p-6">
                        <MapPinOffIcon className="size-8 text-muted-foreground" />
                        <p className="font-semibold">The live map needs OneSync</p>
                        <p className="text-sm text-muted-foreground max-w-md">
                            Without OneSync the server does not know where the players are.
                            Turn it on in Settings, FXServer, then restart the server.
                        </p>
                    </div>
                ) : null}
                {isWaiting ? (
                    <div className="absolute left-3 top-3 z-10 rounded-md bg-card/90 px-3 py-1.5 text-sm text-muted-foreground">
                        Waiting for the server to report positions...
                    </div>
                ) : null}
                <MapView
                    players={players}
                    onSelectPlayer={(netid) => { setSelectedNetids(null); openPlayer(netid); }}
                    onSelectCluster={setSelectedNetids}
                />
                {selectedNetids ? (
                    <div className="absolute right-0 top-0 z-10 h-full w-72 rounded-r-lg border-l bg-card shadow-lg flex flex-col">
                        <div className="flex items-center justify-between px-3 py-2 border-b">
                            <span className="text-sm font-semibold">{selectedNetids.length} players here</span>
                            <Button variant="ghost" size="sm" onClick={() => setSelectedNetids(null)}>Close</Button>
                        </div>
                        <ScrollArea className="flex-1">
                            <ul className="p-1">
                                {selectedNetids.map((netid) => (
                                    <li key={netid}>
                                        <button
                                            type="button"
                                            className="w-full truncate rounded-md px-3 py-2 text-left text-sm hover:bg-secondary"
                                            onClick={() => openPlayer(netid)}
                                        >
                                            <span className="text-muted-foreground">{netid} |</span>{' '}
                                            {namesByNetid.get(netid) ?? 'unknown'}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </ScrollArea>
                    </div>
                ) : null}
            </div>
        </div>
    );
}
