/** Grid clustering in map units. Pure TS: no React/Leaflet. Every input point lands in exactly one output. */
export interface Pt { id: string; x: number; y: number }
export type Cluster<T extends Pt> =
  | { type: "single"; item: T }
  | { type: "cluster"; x: number; y: number; items: T[]; minX: number; minY: number; maxX: number; maxY: number };

/** CRS.Simple: 1 map unit = 2^zoom px. Clustering stops at `maxZoom`. */
export function clusterPoints<T extends Pt>(points: T[], zoom: number, cellPx = 56, maxZoom = 5): Cluster<T>[] {
  if (zoom >= maxZoom) return points.map((item) => ({ type: "single", item }));
  const cell = cellPx / 2 ** zoom;
  const cells = new Map<string, T[]>();
  for (const p of points) {
    const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
    const c = cells.get(k);
    if (c) c.push(p); else cells.set(k, [p]);
  }
  const out: Cluster<T>[] = [];
  for (const items of cells.values()) {
    if (items.length === 1) { out.push({ type: "single", item: items[0]! }); continue; }
    let sx = 0, sy = 0, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of items) { sx += p.x; sy += p.y; minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    out.push({ type: "cluster", x: sx / items.length, y: sy / items.length, items, minX, minY, maxX, maxY });
  }
  return out;
}

/** Point-in-polygon (even-odd) over all rings, used for district filtering. */
export function inRings(x: number, y: number, rings: [number, number][][]): boolean {
  let inside = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i]!, [xj, yj] = r[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Case- and accent-insensitive normalisation for search. */
export const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
