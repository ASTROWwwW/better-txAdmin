import type { PlayerData } from "../../hooks/usePlayerListListener";

export type Marker = { x: number; y: number; player: PlayerData };
export type Cluster = { x: number; y: number; players: PlayerData[] };

/**
 * Merges the markers that are at most `mergeDist` apart (transitively) into clusters, placed at their centroid.
 * Markers are bucketed in a grid with cells as big as `mergeDist`, so two markers close enough to merge
 * are always in the same or in adjacent cells, and each marker is only compared with its neighbours.
 */
export const clusterMarkers = (markers: Marker[], mergeDist: number): Cluster[] => {
  const parent = markers.map((_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };

  const grid = new Map<string, number[]>();
  markers.forEach((m, i) => {
    const cellX = Math.floor(m.x / mergeDist);
    const cellY = Math.floor(m.y / mergeDist);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const neighbours = grid.get(`${cellX + dx},${cellY + dy}`);
        if (!neighbours) continue;
        for (const j of neighbours) {
          const rootI = root(i);
          const rootJ = root(j);
          if (rootI !== rootJ && Math.hypot(m.x - markers[j].x, m.y - markers[j].y) <= mergeDist) {
            parent[rootI] = rootJ;
          }
        }
      }
    }
    const key = `${cellX},${cellY}`;
    const cell = grid.get(key);
    if (cell) cell.push(i);
    else grid.set(key, [i]);
  });

  const groups = new Map<number, Marker[]>();
  markers.forEach((m, i) => {
    const r = root(i);
    const group = groups.get(r);
    if (group) group.push(m);
    else groups.set(r, [m]);
  });
  return [...groups.values()].map((g) => {
    let sumX = 0;
    let sumY = 0;
    for (const m of g) {
      sumX += m.x;
      sumY += m.y;
    }
    return { x: sumX / g.length, y: sumY / g.length, players: g.map((m) => m.player) };
  });
};
