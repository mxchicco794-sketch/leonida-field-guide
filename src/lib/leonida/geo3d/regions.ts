/** Lossless residency adapter. The original processor and its v4 output stay unchanged. */
import { assertProcessed, CX, CY, EXTENT, PROCESSOR_VERSION, type Mesh, type Processed } from "./process";
import type { BMesh } from "./buildings";

export const REGIONAL_SCHEMA_VERSION = 1;
export const REGION_COLUMNS = 8;
export type Bounds = { min: [number, number, number]; max: [number, number, number]; center: [number, number, number] };
export type GlobalGeometry = Omit<Processed, "roads" | "buildings"> & { buildings: Pick<Processed["buildings"], "far" | "stats"> };
export interface RegionMeta { id: string; kind: "building" | "road"; roadKind?: string; bounds: Bounds; bytes: number; triangles: number; checksum: string }
export interface RegionPayload { id: string; mesh: Mesh | BMesh }
export interface RegionManifest { schema: number; processor: number; generation: string; createdAt: number; regions: RegionMeta[]; legacyNearBytes: number }
export interface RegionalPrepared { global: GlobalGeometry; manifest: RegionManifest }
export interface RegionalBundle extends RegionalPrepared { payloads: RegionPayload[] }

export const meshBytes = (mesh: Mesh | BMesh) => mesh.position.byteLength + mesh.index.byteLength + ("color" in mesh ? mesh.color.byteLength : 0);
export const meshArrays = (m: Mesh | BMesh): ArrayBufferView[] => [m.position, m.index, ...("color" in m ? [m.color] : [])];

/** Two deterministic byte hashes for accidental corruption detection, not a security signature. */
export function checksum(arrays: ArrayBufferView[]): string {
  let a = 2166136261, b = 5381;
  for (const array of arrays) {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (const byte of bytes) { a = Math.imul(a ^ byte, 16777619); b = Math.imul(b, 33) ^ byte; }
    a = Math.imul(a ^ bytes.length, 16777619); b ^= bytes.length;
  }
  return `${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
}

export function meshBounds(mesh: Mesh | BMesh): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.position.length; i += 3) for (const axis of [0, 1, 2] as const) {
    const value = mesh.position[i + axis];
    if (value === undefined || !Number.isFinite(value)) throw new Error("Invalid regional coordinate");
    min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
  }
  return { min, max, center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] };
}

export function roadCell(worldX: number, worldZ: number): string {
  const col = Math.max(0, Math.min(7, Math.floor((worldX + CX - EXTENT.minX) / 84)));
  const row = Math.max(0, Math.min(7, Math.floor((worldZ + CY - EXTENT.minY) / 80)));
  return `${col},${row}`;
}

export function partitionRoad(mesh: Mesh, kind: string): RegionPayload[] {
  const buckets = new Map<string, { positions: number[]; indices: number[]; vertices: Map<number, number> }>();
  for (let i = 0; i < mesh.index.length; i += 3) {
    const indices = [mesh.index[i], mesh.index[i + 1], mesh.index[i + 2]];
    if (indices.some((v) => v === undefined)) throw new Error("Malformed road triangle");
    let x = 0, z = 0;
    for (const vertex of indices) {
      if (vertex === undefined) throw new Error("Missing road vertex");
      x += mesh.position[vertex * 3] ?? NaN; z += mesh.position[vertex * 3 + 2] ?? NaN;
    }
    const id = `r:${kind}:${roadCell(x / 3, z / 3)}`;
    let bucket = buckets.get(id);
    if (!bucket) { bucket = { positions: [], indices: [], vertices: new Map() }; buckets.set(id, bucket); }
    for (const vertex of indices) {
      if (vertex === undefined) throw new Error("Missing road vertex");
      let local = bucket.vertices.get(vertex);
      if (local === undefined) {
        local = bucket.positions.length / 3; bucket.vertices.set(vertex, local);
        for (let axis = 0; axis < 3; axis++) {
          const value = mesh.position[vertex * 3 + axis];
          if (value === undefined) throw new Error("Road vertex out of range");
          bucket.positions.push(value);
        }
      }
      bucket.indices.push(local);
    }
  }
  return [...buckets].map(([id, b]) => ({ id, mesh: { position: new Float32Array(b.positions), index: new Uint32Array(b.indices) } }));
}

export function adaptRegions(data: Processed, createdAt = Date.now()): RegionalBundle {
  assertProcessed(data);
  const payloads: RegionPayload[] = data.buildings.chunks.map((mesh, i) => ({ id: `b:${checksum(meshArrays(mesh))}:${i}`, mesh }));
  for (const [kind, mesh] of Object.entries(data.roads)) payloads.push(...partitionRoad(mesh, kind));
  const regions = payloads.map(({ id, mesh }): RegionMeta => ({
    id, kind: id.startsWith("b:") ? "building" : "road", ...(id.startsWith("r:") ? { roadKind: id.split(":")[1] ?? "street" } : {}),
    bounds: meshBounds(mesh), bytes: meshBytes(mesh), triangles: mesh.index.length / 3, checksum: checksum(meshArrays(mesh)),
  }));
  const global: GlobalGeometry = { version: data.version, land: data.land, surface: data.surface, roadsFar: data.roadsFar, rails: data.rails, bounds: data.bounds, stats: data.stats, buildings: { far: data.buildings.far, stats: data.buildings.stats } };
  const identity = checksum([data.land.position, data.land.index, ...Object.values(data.surface).flatMap(meshArrays), ...Object.values(data.roads).flatMap(meshArrays), ...Object.values(data.roadsFar).flatMap(meshArrays), ...data.buildings.chunks.flatMap(meshArrays), ...meshArrays(data.buildings.far), data.rails]);
  const manifest: RegionManifest = { schema: REGIONAL_SCHEMA_VERSION, processor: PROCESSOR_VERSION, generation: `p4-r1-grid8-${identity}`, createdAt, regions,
    legacyNearBytes: data.buildings.chunks.reduce((s, m) => s + meshBytes(m) + m.position.byteLength, 0) + Object.values(data.roads).reduce((s, m) => s + meshBytes(m), 0) };
  return { global, manifest, payloads };
}

export function assertRegion(payload: RegionPayload, meta: RegionMeta) {
  const m = payload?.mesh;
  if (!m || payload.id !== meta.id || !(m.position instanceof Float32Array) || !(m.index instanceof Uint32Array) || m.position.length % 3 || m.index.length % 3) throw new Error("Malformed regional payload");
  if (meta.kind === "building" && (!("color" in m) || !(m.color instanceof Float32Array) || m.color.length !== m.position.length)) throw new Error("Malformed building region");
  for (const i of m.index) if (i >= m.position.length / 3) throw new Error("Regional index out of range");
  const bounds = meshBounds(m);
  if (meshBytes(m) !== meta.bytes || m.index.length / 3 !== meta.triangles || checksum(meshArrays(m)) !== meta.checksum || JSON.stringify(bounds) !== JSON.stringify(meta.bounds)) throw new Error("Regional integrity mismatch");
}

export function assertPrepared(value: unknown): asserts value is RegionalPrepared {
  const p = value as RegionalPrepared;
  if (!p || p.manifest?.schema !== REGIONAL_SCHEMA_VERSION || p.manifest.processor !== PROCESSOR_VERSION || !p.manifest.generation || !Array.isArray(p.manifest.regions)) throw new Error("Regional manifest version mismatch");
  if (new Set(p.manifest.regions.map((m) => m.id)).size !== p.manifest.regions.length) throw new Error("Duplicate regional IDs");
  // Reuse the v4 validator for unchanged global layers, without inventing near geometry.
  assertProcessed({ ...p.global, roads: {}, buildings: { ...p.global.buildings, chunks: [] } });
  for (const m of p.manifest.regions) {
    if (!m.id || !["building", "road"].includes(m.kind) || !Number.isFinite(m.bytes) || m.bytes <= 0 || !Number.isInteger(m.triangles) || m.triangles <= 0 || !m.checksum || [...m.bounds.min, ...m.bounds.max, ...m.bounds.center].some((v) => !Number.isFinite(v))) throw new Error("Malformed region metadata");
  }
}

export function globalTransfers(global: GlobalGeometry): ArrayBuffer[] {
  return [global.land, ...Object.values(global.surface), ...Object.values(global.roadsFar), global.buildings.far].flatMap((m) => meshArrays(m).map((a) => a.buffer as ArrayBuffer)).concat(global.rails.buffer as ArrayBuffer);
}