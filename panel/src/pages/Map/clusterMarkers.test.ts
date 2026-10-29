import { suite, it, expect } from 'vitest';
import { clusterMarkers } from './clusterMarkers';

type Item = { id: number };
const mk = (pts: [number, number][]) => pts.map(([x, y], i) => ({ x, y, item: { id: i } as Item }));

//The straightforward version the grid one replaces: compare every pair, merge transitively
const referenceCluster = (markers: ReturnType<typeof mk>, mergeDist: number) => {
    const parent = markers.map((_, i) => i);
    const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    for (let i = 0; i < markers.length; i++) {
        for (let j = i + 1; j < markers.length; j++) {
            if (Math.hypot(markers[i].x - markers[j].x, markers[i].y - markers[j].y) <= mergeDist) {
                parent[root(i)] = root(j);
            }
        }
    }
    const groups = new Map<number, typeof markers>();
    markers.forEach((m, i) => groups.set(root(i), [...(groups.get(root(i)) ?? []), m]));
    return [...groups.values()].map((g) => ({
        x: g.reduce((sum, m) => sum + m.x, 0) / g.length,
        y: g.reduce((sum, m) => sum + m.y, 0) / g.length,
        items: g.map((m) => m.item),
    }));
};

const D = 20.8;

suite('clusterMarkers', () => {
    it('returns nothing for nothing and a single cluster for a single marker', () => {
        expect(clusterMarkers([], D)).toEqual([]);
        expect(clusterMarkers(mk([[5, 6]]), D)).toEqual([{ x: 5, y: 6, items: [{ id: 0 }] }]);
    });

    it('merges markers closer than the distance, at their centroid, and leaves the others alone', () => {
        const out = clusterMarkers(mk([[0, 0], [10, 0], [100, 100]]), D);
        expect(out).toEqual([
            { x: 5, y: 0, items: [{ id: 0 }, { id: 1 }] },
            { x: 100, y: 100, items: [{ id: 2 }] },
        ]);
    });

    it('merges transitively along a chain, and counts the exact distance as close', () => {
        expect(clusterMarkers(mk([[0, 0], [D, 0], [2 * D, 0]]), D)).toHaveLength(1);
        expect(clusterMarkers(mk([[0, 0], [D + 0.001, 0]]), D)).toHaveLength(2);
    });

    it('keeps markers at the same spot together and never merges NaN positions', () => {
        expect(clusterMarkers(mk([[3, 3], [3, 3], [3, 3]]), D)).toHaveLength(1);
        expect(clusterMarkers(mk([[NaN, 0], [NaN, 0]]), D)).toHaveLength(2);
    });

    it('gives the same clusters, order and centroids as comparing every pair', () => {
        let seed = 99;
        const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
        for (let round = 0; round < 400; round++) {
            const n = Math.floor(rnd() * 120);
            const spread = [40, 150, 600, 3000][Math.floor(rnd() * 4)];
            const pts: [number, number][] = [];
            for (let i = 0; i < n; i++) {
                if (pts.length && rnd() < 0.3) {
                    const [px, py] = pts[Math.floor(rnd() * pts.length)];
                    pts.push([px + (rnd() - 0.5) * D * 2, py + (rnd() - 0.5) * D * 2]);
                } else {
                    pts.push([(rnd() - 0.5) * spread, (rnd() - 0.5) * spread]);
                }
            }
            const markers = mk(pts);
            expect(clusterMarkers(markers, D), `round ${round}`).toEqual(referenceCluster(markers, D));
        }
    });

    it('stays fast with 2000 markers piled in one spot', () => {
        const start = performance.now();
        const out = clusterMarkers(mk(Array.from({ length: 2000 }, () => [10, 10] as [number, number])), D);
        expect(out).toHaveLength(1);
        expect(performance.now() - start).toBeLessThan(500);
    });
});
