/**
 * Pure 3D preprocessing of the original Open GTA 6 Map geometry (CC BY 4.0).
 * Runs inside a Web Worker (worker.ts) or, as a fallback, on the main thread.
 * No React / DOM. Output is typed arrays ready for THREE.BufferGeometry.
 */
import { ShapeUtils, Vector2 } from "three";
import { buildBuildings, type BMesh, type BuildingSet } from "./buildings";

/** Bump when the processing output changes; invalidates the IndexedDB cache. */
export const PROCESSOR_VERSION = 4;

/** World transform: map units (x right, y down) → world X = x − CX, Z = y − CY, Y up. */
export const CX = 496, CY = 480;
export const LAND_H = 1.2;
/** Valid map-unit extent, from MAP_BOUNDS [[-800,160],[-160,832]] in api.ts. */
export const EXTENT = { minX: 160, maxX: 832, minY: 160, maxY: 800 } as const;

/**
 * Stylized road strip full widths in map units, by roads.json `kind`.
 * Not real-world lane widths (the source has none); chosen for legibility.
 */
export const ROAD_WIDTH: Record<string, number> = { highway: 1.0, main: 0.75, minor: 0.5, street: 0.4 };
export const DEFAULT_ROAD_WIDTH = 0.4;
/** Small per-kind lift above land so strips never z-fight each other. */
export const ROAD_LIFT: Record<string, number> = { highway: 0.08, main: 0.06, minor: 0.04, street: 0.03 };

export type Pt = [number, number];

/**
 * Road level of detail. Douglas–Peucker tolerance in map units per LOD;
 * the far LOD keeps only arterial kinds. Endpoints and any vertex shared by
 * two or more lines (junctions) are locked, so connections survive.
 */
export const LOD = { near: 0.25, far: 1.5 } as const;
export const FAR_KINDS = ["highway", "main"];
/** Camera distance (world units) above which the far LOD is shown. */
export const FAR_DISTANCE = 260;

const ptKey = (p: Pt) => `${p[0]},${p[1]}`;

/** Points that must never be removed: line endpoints and vertices used by ≥2 lines. */
export function junctions(lines: Pt[][]): Set<string> {
  const seen = new Map<string, number>(), lock = new Set<string>();
  for (const l of lines) {
    lock.add(ptKey(l[0]!)); lock.add(ptKey(l[l.length - 1]!));
    for (const k of new Set(l.map(ptKey))) seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  for (const [k, n] of seen) if (n > 1) lock.add(k);
  return lock;
}

function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** Douglas–Peucker that never drops locked points (split at them first). */
export function simplify(line: Pt[], tol: number, lock: Set<string>): Pt[] {
  if (line.length < 3 || tol <= 0) return line;
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  for (let i = 1; i < line.length - 1; i++) if (lock.has(ptKey(line[i]!))) keep[i] = 1;
  const dp = (i: number, j: number) => {
    let m = -1, md = 0;
    for (let k = i + 1; k < j; k++) { const d = segDist(line[k]!, line[i]!, line[j]!); if (d > md) { md = d; m = k; } }
    if (m >= 0 && md > tol) { keep[m] = 1; dp(i, m); dp(m, j); }
  };
  let s = 0;
  for (let i = 1; i < line.length; i++) if (keep[i]) { dp(s, i); s = i; }
  return line.filter((_, i) => keep[i]);
}
export interface Mesh { position: Float32Array; index: Uint32Array }
export interface Stats { rejectedPoints: number; rejectedRings: number; rejectedLines: number; polygons: number; lines: number }
export interface Processed {
  buildings: BuildingSet; // STYLIZED heights, see buildings.ts
  version: number;
  land: Mesh;
  surface: Record<string, Mesh>;
  roads: Record<string, Mesh>; // near LOD: all kinds, light simplification
  roadsFar: Record<string, Mesh>; // far LOD: FAR_KINDS only, strong simplification
  rails: Float32Array; // line segment pairs (x,y,z,x,y,z)
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  stats: Stats;
}
export interface RawGeometry {
  land: unknown;
  surface: unknown;
  roads: unknown;
  rails: unknown;
}

export const toWorld = (x: number, y: number, h = 0): [number, number, number] => [x - CX, h, y - CY];

export function validPoint(p: unknown): p is Pt {
  if (!Array.isArray(p) || p.length < 2) return false;
  const [x, y] = p as number[];
  return Number.isFinite(x) && Number.isFinite(y) &&
    x! >= EXTENT.minX && x! <= EXTENT.maxX && y! >= EXTENT.minY && y! <= EXTENT.maxY;
}

const newStats = (): Stats => ({ rejectedPoints: 0, rejectedRings: 0, rejectedLines: 0, polygons: 0, lines: 0 });

/** Drop invalid points, consecutive duplicates and the closing point; null if < 3 distinct points or zero area. */
export function cleanRing(ring: unknown, s: Stats = newStats()): Pt[] | null {
  if (!Array.isArray(ring)) { s.rejectedRings++; return null; }
  const out: Pt[] = [];
  for (const p of ring) {
    if (!validPoint(p)) { s.rejectedPoints++; continue; }
    const l = out[out.length - 1];
    if (!l || l[0] !== p[0] || l[1] !== p[1]) out.push([p[0], p[1]]);
  }
  const f = out[0], l = out[out.length - 1];
  if (out.length > 1 && f && l && f[0] === l[0] && f[1] === l[1]) out.pop();
  if (out.length < 3 || Math.abs(ShapeUtils.area(out.map(([x, y]) => new Vector2(x, y)))) < 1e-9) { s.rejectedRings++; return null; }
  return out;
}

export function cleanLine(line: unknown, s: Stats = newStats()): Pt[] | null {
  if (!Array.isArray(line)) { s.rejectedLines++; return null; }
  const out: Pt[] = [];
  for (const p of line) {
    if (!validPoint(p)) { s.rejectedPoints++; continue; }
    const l = out[out.length - 1];
    if (!l || l[0] !== p[0] || l[1] !== p[1]) out.push([p[0], p[1]]);
  }
  if (out.length < 2) { s.rejectedLines++; return null; }
  return out;
}

class Builder {
  pos: number[] = []; idx: number[] = [];
  /** Push a triangle, flipping winding so its face points +Y. */
  tri(a: number, b: number, c: number) {
    const p = this.pos;
    const ax = p[a * 3]!, az = p[a * 3 + 2]!;
    const cy = (p[b * 3]! - ax) * (p[c * 3 + 2]! - az) - (p[b * 3 + 2]! - az) * (p[c * 3]! - ax);
    // normal.y = (c−a)×(b−a) in XZ; for +Y we need (b−a)×(c−a).y = −cy > 0 ⇒ cy < 0
    if (cy > 0) this.idx.push(a, c, b); else this.idx.push(a, b, c);
  }
  v(x: number, y: number, z: number) { this.pos.push(x, y, z); return this.pos.length / 3 - 1; }
  done(): Mesh { return { position: new Float32Array(this.pos), index: new Uint32Array(this.idx) }; }
}

/** Triangulate one polygon (outer + holes) at height h into builder b. Returns false if rejected. */
export function addPolygon(b: Builder, rings: unknown, h: number, s: Stats, walls = false): boolean {
  if (!Array.isArray(rings)) { s.rejectedRings++; return false; }
  const outer = cleanRing(rings[0], s);
  if (!outer) return false;
  const holes = rings.slice(1).map((r) => cleanRing(r, s)).filter((r): r is Pt[] => !!r);
  const all = [outer, ...holes];
  const faces = ShapeUtils.triangulateShape(outer.map(([x, y]) => new Vector2(x, y)), holes.map((r) => r.map(([x, y]) => new Vector2(x, y))));
  if (!faces.length) { s.rejectedRings++; return false; }
  const base = b.pos.length / 3;
  for (const r of all) for (const [x, y] of r) b.pos.push(x - CX, h, y - CY);
  for (const [i, j, k] of faces) b.tri(base + i!, base + j!, base + k!);
  if (walls) for (const r of all) for (let i = 0; i < r.length; i++) {
    const [x0, y0] = r[i]!, [x1, y1] = r[(i + 1) % r.length]!;
    const a = b.v(x0 - CX, 0, y0 - CY), c = b.v(x1 - CX, 0, y1 - CY), d = b.v(x1 - CX, h, y1 - CY), e = b.v(x0 - CX, h, y0 - CY);
    b.idx.push(a, c, d, a, d, e);
  }
  s.polygons++;
  return true;
}

/** Flat strip of full width w along a polyline, mitered joins (miter clamped to 2× half-width). */
export function addStrip(b: Builder, line: Pt[], w: number, h: number) {
  const hw = w / 2, n = line.length, base = b.pos.length / 3;
  for (let i = 0; i < n; i++) {
    const p = line[i]!, prev = line[Math.max(0, i - 1)]!, next = line[Math.min(n - 1, i + 1)]!;
    const seg = (a: Pt, c: Pt) => { const dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy) || 1; return [-dy / L, dx / L] as const; };
    const n1 = i > 0 ? seg(prev, p) : seg(p, next), n2 = i < n - 1 ? seg(p, next) : n1;
    let mx = n1[0] + n2[0], my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my);
    let k = hw;
    if (ml < 1e-6) { mx = n1[0]; my = n1[1]; } else {
      mx /= ml; my /= ml;
      const dot = mx * n1[0] + my * n1[1];
      k = Math.min(hw / Math.max(dot, 1e-6), hw * 2);
    }
    b.v(p[0] + mx * k - CX, h, p[1] + my * k - CY);
    b.v(p[0] - mx * k - CX, h, p[1] - my * k - CY);
  }
  for (let i = 0; i < n - 1; i++) { const a = base + i * 2; b.tri(a, a + 1, a + 2); b.tri(a + 1, a + 3, a + 2); }
}

function featureLines(fc: unknown): { props: Record<string, unknown>; lines: unknown[] }[] {
  const feats = (fc as { features?: unknown[] })?.features;
  if (!Array.isArray(feats)) throw new Error("Invalid FeatureCollection");
  return feats.map((f) => {
    const g = (f as { geometry?: { type?: string; coordinates?: unknown } }).geometry;
    const props = ((f as { properties?: Record<string, unknown> }).properties) ?? {};
    if (g?.type === "LineString") return { props, lines: [g.coordinates] };
    if (g?.type === "MultiLineString" && Array.isArray(g.coordinates)) return { props, lines: g.coordinates };
    return { props, lines: [] };
  });
}

export function processGeometry(raw: RawGeometry): Processed {
  const s = newStats();
  if (!Array.isArray(raw.land)) throw new Error("Invalid land.json");
  const land = new Builder();
  for (const poly of raw.land) addPolygon(land, poly, LAND_H, s, true);

  const surfB: Record<string, Builder> = {};
  const sf = (raw.surface as { features?: unknown[] })?.features;
  if (!Array.isArray(sf)) throw new Error("Invalid surface.json");
  const footprints: unknown[] = [];
  for (const f of sf) {
    const g = (f as { geometry?: { type?: string; coordinates?: unknown } }).geometry;
    const layer = String((f as { properties?: Record<string, unknown> }).properties?.["layer"] ?? "other");
    const polys = g?.type === "Polygon" ? [g.coordinates] : g?.type === "MultiPolygon" && Array.isArray(g.coordinates) ? g.coordinates : [];
    if (layer === "building") { for (const p of polys) footprints.push(Array.isArray(p) ? p[0] : null); continue; }
    const b = (surfB[layer] ??= new Builder());
    for (const p of polys) addPolygon(b, p, LAND_H + 0.01, s);
  }

  const byKind: Record<string, Pt[][]> = {};
  for (const { props, lines } of featureLines(raw.roads)) {
    const kind = String(props["kind"] ?? "street");
    for (const l of lines) { const c = cleanLine(l, s); if (c) { (byKind[kind] ??= []).push(c); s.lines++; } }
  }
  const lock = junctions(Object.values(byKind).flat());
  const roadB: Record<string, Builder> = {}, farB: Record<string, Builder> = {};
  for (const [kind, ls] of Object.entries(byKind)) {
    const w = ROAD_WIDTH[kind] ?? DEFAULT_ROAD_WIDTH, h = LAND_H + (ROAD_LIFT[kind] ?? 0.03);
    const nb = (roadB[kind] = new Builder());
    for (const l of ls) addStrip(nb, simplify(l, LOD.near, lock), w, h);
    if (FAR_KINDS.includes(kind)) {
      const fb = (farB[kind] = new Builder());
      // far view: strips widened 1.25× so arterials stay legible from altitude
      for (const l of ls) addStrip(fb, simplify(l, LOD.far, lock), w * 1.25, h);
    }
  }

  const rail: number[] = [];
  for (const { lines } of featureLines(raw.rails)) for (const l of lines) {
    const c = cleanLine(l, s);
    if (!c) continue;
    s.lines++;
    for (let i = 1; i < c.length; i++) rail.push(...toWorld(c[i - 1]![0], c[i - 1]![1], LAND_H + 0.1), ...toWorld(c[i]![0], c[i]![1], LAND_H + 0.1));
  }

  const buildings = buildBuildings(footprints, s);
  const out: Processed = {
    buildings,
    version: PROCESSOR_VERSION,
    land: land.done(),
    surface: Object.fromEntries(Object.entries(surfB).map(([k, b]) => [k, b.done()])),
    roads: Object.fromEntries(Object.entries(roadB).map(([k, b]) => [k, b.done()])),
    roadsFar: Object.fromEntries(Object.entries(farB).map(([k, b]) => [k, b.done()])),
    rails: new Float32Array(rail),
    bounds: { minX: EXTENT.minX - CX, maxX: EXTENT.maxX - CX, minZ: EXTENT.minY - CY, maxZ: EXTENT.maxY - CY },
    stats: s,
  };
  if (!out.land.index.length) throw new Error("Land geometry is empty after validation");
  assertProcessed(out);
  return out;
}

/** Shape-integrity check run before rendering (also on cached data). */
export function assertProcessed(p: Processed) {
  if (!p || p.version !== PROCESSOR_VERSION) throw new Error("Processed geometry version mismatch");
  const meshes: Mesh[] = [...(p.buildings?.chunks ?? []), ...(p.buildings ? [p.buildings.far] : []), p.land, ...Object.values(p.surface), ...Object.values(p.roads), ...Object.values(p.roadsFar)];
  for (const m of meshes) {
    if (!(m.position instanceof Float32Array) || !(m.index instanceof Uint32Array)) throw new Error("Bad buffer types");
    if (m.position.length % 3 || m.index.length % 3) throw new Error("Buffer length not a multiple of 3");
    const nv = m.position.length / 3;
    for (let i = 0; i < m.index.length; i++) if (m.index[i]! >= nv) throw new Error("Index out of range");
    for (let i = 0; i < m.position.length; i++) if (!Number.isFinite(m.position[i]!)) throw new Error("Non-finite vertex");
  }
  for (const b of [...(p.buildings?.chunks ?? []), p.buildings?.far]) {
    if (!b || !(b.color instanceof Float32Array) || b.color.length !== b.position.length) throw new Error("Bad building buffers");
  }
  if (p.rails.length % 6) throw new Error("Rail segments malformed");
}

/** Collect the ArrayBuffers to transfer from a worker (zero-copy). */
export function transferables(p: Processed): ArrayBuffer[] {
  const ms = [p.land, ...Object.values(p.surface), ...Object.values(p.roads), ...Object.values(p.roadsFar)];
  const bs: BMesh[] = [...p.buildings.chunks, p.buildings.far];
  return [...ms.flatMap((m) => [m.position.buffer as ArrayBuffer, m.index.buffer as ArrayBuffer]), ...bs.flatMap((m) => [m.position.buffer as ArrayBuffer, m.color.buffer as ArrayBuffer, m.index.buffer as ArrayBuffer]), p.rails.buffer as ArrayBuffer];
}

export { Builder };
