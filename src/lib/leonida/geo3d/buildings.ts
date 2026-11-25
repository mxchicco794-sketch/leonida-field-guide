/**
 * STYLIZED building reconstruction from the original surface.json "building"
 * footprints (CC BY 4.0). The source has NO heights, floors, roofs or use types:
 * every height/class below is an invented, documented rule — not GTA VI data.
 */
import { ShapeUtils, Vector2 } from "three";
import { CX, CY, EXTENT, LAND_H, cleanRing, type Pt, type Stats } from "./process";

export type BuildingClass = "small" | "midrise" | "large-lowrise" | "tower";
/**
 * Height rule (map units; road widths are 0.6–1.6 for scale):
 *  - large-lowrise: footprint ≥ 3 → 0.5–0.9 (warehouse-like slab)
 *  - tower: footprint 0.15–3 and ≥ TOWER_DENSITY neighbours within 5 units → 1.6–5.0, scaled by density
 *  - small: footprint < 0.15 → 0.25–0.5
 *  - midrise: everything else → 0.5–1.2
 * A per-building hash of the centroid adds deterministic variation.
 */
export const TOWER_DENSITY = 40;
export const HEIGHT = { small: [0.25, 0.5], midrise: [0.5, 1.2], "large-lowrise": [0.5, 0.9], tower: [1.6, 5] } as const;
/** Far LOD only keeps buildings at least this tall. */
export const FAR_MIN_HEIGHT = 1.2;
export const CHUNKS = 8;

/** Vertex colours (linear 0..1): wall base, roof. Kept muted to the dark identity. */
const PAL: Record<BuildingClass, { wall: [number, number, number]; roof: [number, number, number] }> = {
  small: { wall: [0.42, 0.38, 0.33], roof: [0.30, 0.22, 0.19] },
  midrise: { wall: [0.40, 0.40, 0.40], roof: [0.27, 0.27, 0.28] },
  "large-lowrise": { wall: [0.33, 0.34, 0.35], roof: [0.38, 0.39, 0.40] },
  tower: { wall: [0.34, 0.40, 0.46], roof: [0.22, 0.25, 0.28] },
};

export const hash = (x: number, y: number) => { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return s - Math.floor(s); };
export const ringArea = (r: Pt[]) => Math.abs(ShapeUtils.area(r.map(([x, y]) => new Vector2(x, y))));
export const centroid = (r: Pt[]): Pt => { let x = 0, y = 0; for (const p of r) { x += p[0]; y += p[1]; } return [x / r.length, y / r.length]; };

export function classify(area: number, density: number): BuildingClass {
  if (area >= 3) return "large-lowrise";
  if (area < 0.15) return "small";
  if (density >= TOWER_DENSITY) return "tower";
  return "midrise";
}
export function heightFor(cls: BuildingClass, density: number, h01: number): number {
  const [lo, hi] = HEIGHT[cls];
  const t = cls === "tower" ? Math.min(1, (density - TOWER_DENSITY) / 80) * 0.7 + h01 * 0.3 : h01;
  return lo + (hi - lo) * t;
}

export interface BMesh { position: Float32Array; color: Float32Array; index: Uint32Array }
export interface BuildingSet { chunks: BMesh[]; far: BMesh; stats: { rendered: number; rejected: number; byClass: Record<BuildingClass, number>; maxHeight: number } }

class BB {
  pos: number[] = []; col: number[] = []; idx: number[] = [];
  v(x: number, y: number, z: number, c: readonly number[]) { this.pos.push(x - CX, y, z - CY); this.col.push(c[0]!, c[1]!, c[2]!); return this.pos.length / 3 - 1; }
  done(): BMesh { return { position: new Float32Array(this.pos), color: new Float32Array(this.col), index: new Uint32Array(this.idx) }; }
}

const shade = (c: readonly number[], k: number) => [c[0]! * k, c[1]! * k, c[2]! * k];

/** Extrude one footprint ring from base to top: walls (darker at the base for depth) + flat roof. */
export function extrude(b: BB, ring: Pt[], base: number, top: number, wall: readonly number[], roof: readonly number[]): boolean {
  const faces = ShapeUtils.triangulateShape(ring.map(([x, y]) => new Vector2(x, y)), []);
  if (!faces.length) return false;
  const o = b.pos.length / 3;
  for (const [x, y] of ring) b.v(x, top, y, roof);
  for (const [i, j, k] of faces) {
    const a = o + i!, c = o + j!, d = o + k!, P = b.pos;
    const cy = (P[c * 3]! - P[a * 3]!) * (P[d * 3 + 2]! - P[a * 3 + 2]!) - (P[c * 3 + 2]! - P[a * 3 + 2]!) * (P[d * 3]! - P[a * 3]!);
    if (cy > 0) b.idx.push(a, d, c); else b.idx.push(a, c, d);
  }
  const lo = shade(wall, 0.55);
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i]!, [x1, y1] = ring[(i + 1) % ring.length]!;
    const a = b.v(x0, base, y0, lo), c = b.v(x1, base, y1, lo), d = b.v(x1, top, y1, wall), e = b.v(x0, top, y0, wall);
    b.idx.push(a, c, d, a, d, e);
  }
  return true;
}

const shrink = (r: Pt[], c: Pt, k: number): Pt[] => r.map(([x, y]) => [c[0] + (x - c[0]) * k, c[1] + (y - c[1]) * k]);

export function buildBuildings(rawRings: unknown[], s: Stats): BuildingSet {
  const rings: Pt[][] = [];
  let rejected = 0;
  for (const r of rawRings) { const c = cleanRing(r, s); if (c) rings.push(c); else rejected++; }
  // density: neighbours within 5 units via a 5-unit grid
  const cs = rings.map(centroid), grid = new Map<string, number>();
  const gk = (x: number, y: number) => `${Math.floor(x / 5)},${Math.floor(y / 5)}`;
  for (const [x, y] of cs) grid.set(gk(x, y), (grid.get(gk(x, y)) ?? 0) + 1);
  const dens = (x: number, y: number) => { let n = 0; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) n += grid.get(gk(x + i * 5, y + j * 5)) ?? 0; return n; };

  const w = (EXTENT.maxX - EXTENT.minX) / CHUNKS, hgt = (EXTENT.maxY - EXTENT.minY) / CHUNKS;
  const chunk: BB[] = Array.from({ length: CHUNKS * CHUNKS }, () => new BB()), far = new BB();
  const byClass: Record<BuildingClass, number> = { small: 0, midrise: 0, "large-lowrise": 0, tower: 0 };
  let rendered = 0, maxHeight = 0;
  rings.forEach((r, i) => {
    const c = cs[i]!, area = ringArea(r), d = dens(c[0], c[1]), h01 = hash(c[0], c[1]);
    const cls = classify(area, d), h = heightFor(cls, d, h01), p = PAL[cls];
    const j = 0.9 + h01 * 0.2, wall = shade(p.wall, j), roof = shade(p.roof, j);
    const ci = Math.min(CHUNKS - 1, Math.floor((c[0] - EXTENT.minX) / w)) + Math.min(CHUNKS - 1, Math.floor((c[1] - EXTENT.minY) / hgt)) * CHUNKS;
    const b = chunk[ci]!;
    const top = LAND_H + h;
    if (cls === "tower" && h > 2.5) {
      // two-tier setback roof (stylized)
      const base = LAND_H + h * 0.75;
      if (!extrude(b, r, LAND_H, base, wall, roof)) { rejected++; return; }
      extrude(b, shrink(r, c, 0.7), base, top, wall, roof);
    } else if (!extrude(b, r, LAND_H, top, wall, roof)) { rejected++; return; }
    if (h >= FAR_MIN_HEIGHT) extrude(far, r, LAND_H, top, wall, roof);
    rendered++; byClass[cls]++; maxHeight = Math.max(maxHeight, h);
  });
  return { chunks: chunk.map((b) => b.done()).filter((m) => m.index.length), far: far.done(), stats: { rendered, rejected, byClass, maxHeight } };
}
export { BB };
