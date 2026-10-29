import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { MAP_IMAGE_PATH, gameToMapRatio, isOnMap } from './mapGeo';
import { clusterMarkers } from './clusterMarkers';
import { clampView, getImageBox, zoomAtPoint, type MapView as ViewState } from './mapViewport';

export type MapPlayer = {
    netid: number;
    x: number;
    y: number;
    label: string;
};

type MapViewProps = {
    players: MapPlayer[];
    onSelectPlayer: (netid: number) => void;
    onSelectCluster: (netids: number[]) => void;
};

const MARKER_SIZE = 26; //px
const MERGE_DIST = MARKER_SIZE * 0.8;
const ZOOM_STEP = 1.25;


/**
 * The satellite map with the players on it: wheel to zoom at the cursor, drag to pan,
 * players that would overlap are merged into a numbered cluster, which opens its list when clicked.
 */
export default function MapView({ players, onSelectPlayer, onSelectCluster }: MapViewProps) {
    const rootRef = useRef<HTMLDivElement>(null);
    const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
    const [size, setSize] = useState({ w: 0, h: 0 });
    const [view, setView] = useState<ViewState>({ zoom: 1, x: 0, y: 0 });

    useLayoutEffect(() => {
        const el = rootRef.current!;
        const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    const box = getImageBox(view, size);

    const clusters = useMemo(() => {
        const markers = players.flatMap((p) => {
            const ratio = gameToMapRatio(p.x, p.y);
            return isOnMap(ratio)
                ? [{ x: ratio.rx * box.width, y: ratio.ry * box.height, item: p }]
                : [];
        });
        return clusterMarkers(markers, MERGE_DIST);
    }, [players, box.width, box.height]);

    const handleWheel = (e: React.WheelEvent) => {
        const rect = rootRef.current!.getBoundingClientRect();
        const cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        setView((v) => zoomAtPoint(v, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, cursor, size));
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        const d = drag.current;
        if (!d || e.buttons !== 1) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) < 4) return;
        d.moved = true;
        d.x = e.clientX;
        d.y = e.clientY;
        setView((v) => clampView({ ...v, x: v.x + dx, y: v.y + dy }, size));
    };

    return (
        <div
            ref={rootRef}
            className={cn(
                'relative size-full min-h-[300px] overflow-hidden rounded-lg bg-[#143d6b] select-none touch-none',
                drag.current?.moved ? 'cursor-grabbing' : 'cursor-grab',
            )}
            data-testid="map-root"
            onWheel={handleWheel}
            onPointerDown={(e) => { drag.current = { x: e.clientX, y: e.clientY, moved: false }; }}
            onPointerMove={handlePointerMove}
            onPointerUp={() => setTimeout(() => { drag.current = null; })}
            onPointerLeave={() => { drag.current = null; }}
        >
            <img
                src={MAP_IMAGE_PATH}
                alt=""
                draggable={false}
                className="absolute max-w-none"
                style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
            />
            {clusters.map((c) => {
                const isCluster = c.items.length > 1;
                return (
                    <button
                        key={c.items.map((p) => p.netid).join(',')}
                        type="button"
                        title={c.items.map((p) => `${p.netid} | ${p.label}`).join('\n')}
                        className={cn(
                            'absolute -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full',
                            'border-2 border-white text-[11px] font-bold shadow-[0_0_4px_rgba(0,0,0,0.6)]',
                            isCluster ? 'bg-orange-600 text-white' : 'bg-primary text-primary-foreground',
                        )}
                        style={{
                            left: box.left + c.x,
                            top: box.top + c.y,
                            width: MARKER_SIZE,
                            height: MARKER_SIZE,
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (drag.current?.moved) return;
                            if (isCluster) onSelectCluster(c.items.map((p) => p.netid));
                            else onSelectPlayer(c.items[0].netid);
                        }}
                    >
                        {isCluster ? (c.items.length >= 10 ? '9+' : c.items.length) : c.items[0].netid}
                    </button>
                );
            })}
        </div>
    );
}
