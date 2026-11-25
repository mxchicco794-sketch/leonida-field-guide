import { describe, expect, it, vi } from "vitest";
import { Builder, CX, CY, LAND_H, ROAD_WIDTH, PROCESSOR_VERSION, addStrip, assertProcessed, cleanLine, cleanRing, processGeometry, toWorld, transferables, validPoint, type Processed } from "./process";
import { CACHE_KEY, MAX_AGE_MS, entryUsability, type CacheEntry, type GeoCache } from "./cache";
import { loadProcessed } from "./load";

const sq = (x: number, y: number, s = 10) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];
const raw = () => ({
  land: [[sq(300, 300, 100), sq(320, 320, 10)]],
  surface: { type: "FeatureCollection", features: [{ properties: { layer: "building" }, geometry: { type: "Polygon", coordinates: [sq(400, 400)] } }] },
  roads: { type: "FeatureCollection", features: [
    { properties: { kind: "highway" }, geometry: { type: "LineString", coordinates: [[300, 300], [350, 300]] } },
    { properties: { kind: "street" }, geometry: { type: "LineString", coordinates: [[300, 300], [300, 350], [350, 350]] } },
  ] },
  rails: { type: "FeatureCollection", features: [{ properties: {}, geometry: { type: "LineString", coordinates: [[310, 310], [320, 310]] } }] },
});

describe("coordinate transform", () => {
  it("maps map units to centred world XZ", () => {
    expect(toWorld(496, 480)).toEqual([0, 0, 0]);
    expect(toWorld(500, 490, 2)).toEqual([4, 2, 10]);
    expect([CX, CY]).toEqual([496, 480]);
  });
});

describe("validation", () => {
  it("rejects non-finite and out-of-extent points", () => {
    expect(validPoint([300, 300])).toBe(true);
    expect(validPoint([NaN, 300])).toBe(false);
    expect(validPoint([10, 300])).toBe(false);
    expect(validPoint([300, 900])).toBe(false);
    expect(validPoint("x")).toBe(false);
  });
  it("cleans rings: closing point, duplicates, degenerate", () => {
    expect(cleanRing([[300, 300], [300, 300], [310, 300], [310, 310], [300, 300]])).toEqual([[300, 300], [310, 300], [310, 310]]);
    expect(cleanRing([[300, 300], [310, 300]])).toBeNull();
    expect(cleanRing([[300, 300], [310, 300], [320, 300]])).toBeNull(); // zero area
  });
  it("needs ≥2 distinct points for lines", () => {
    expect(cleanLine([[300, 300], [300, 300]])).toBeNull();
    expect(cleanLine([[300, 300], [301, 300]])).toHaveLength(2);
  });
  it("assertProcessed catches broken buffers", () => {
    const p = processGeometry(raw());
    const bad: Processed = { ...p, land: { position: p.land.position, index: new Uint32Array([0, 1, 999999]) } };
    expect(() => assertProcessed(bad)).toThrow(/out of range/);
    expect(() => assertProcessed({ ...p, version: 0 })).toThrow(/version/);
  });
});

describe("road strips", () => {
  it("documented widths by kind", () => {
    expect(ROAD_WIDTH).toEqual({ highway: 1.0, main: 0.75, minor: 0.5, street: 0.4 });
  });
  it("straight strip has the kind's full width and faces up", () => {
    const b = new Builder();
    addStrip(b, [[300, 300], [350, 300]], ROAD_WIDTH["highway"]!, 1);
    const m = b.done();
    expect(m.position.length).toBe(4 * 3);
    expect(m.index.length).toBe(6);
    expect(Math.abs(m.position[2]! - m.position[5]!)).toBeCloseTo(1.0);
    for (let t = 0; t < m.index.length; t += 3) {
      const [a, c, d] = [m.index[t]!, m.index[t + 1]!, m.index[t + 2]!].map((i) => [m.position[i * 3]!, m.position[i * 3 + 2]!]);
      const ny = (d![0]! - a![0]!) * (c![1]! - a![1]!) - (c![0]! - a![0]!) * (d![1]! - a![1]!);
      expect(ny).toBeGreaterThan(0);
    }
  });
  it("miter at a right angle is clamped (≤ 2× half-width)", () => {
    const b = new Builder();
    addStrip(b, [[300, 300], [300, 350], [350, 350]], 0.6, 1);
    const p = b.done().position;
    const d = Math.hypot(p[6]! - p[9]!, p[8]! - p[11]!);
    expect(d).toBeLessThanOrEqual(0.6 * 2 + 1e-6);
    expect(d).toBeGreaterThan(0.6);
  });
});

describe("worker preprocessing pipeline", () => {
  it("produces typed, valid layers", () => {
    const p = processGeometry(raw());
    expect(p.version).toBe(PROCESSOR_VERSION);
    expect(p.land.position).toBeInstanceOf(Float32Array);
    expect(p.land.index.length).toBeGreaterThan(0);
    expect(Object.keys(p.roads).sort()).toEqual(["highway", "street"]);
    expect(Object.keys(p.surface)).toEqual([]);
    expect(p.buildings.stats.rendered).toBe(1);
    expect(p.rails.length).toBe(6);
    expect(p.land.position[1]).toBeCloseTo(LAND_H);
    expect(transferables(p).length).toBe(2 + 4 + 2 + 3 + 3 + 1);
  });
  it("skips invalid shapes and counts them", () => {
    const r = raw();
    (r.roads.features as unknown[]).push({ properties: { kind: "main" }, geometry: { type: "LineString", coordinates: [[NaN, 1]] } });
    const p = processGeometry(r);
    expect(p.stats.rejectedLines).toBe(1);
  });
  it("throws on malformed input", () => {
    expect(() => processGeometry({ ...raw(), land: {} })).toThrow();
    expect(() => processGeometry({ ...raw(), land: [] })).toThrow(/empty/);
  });
});

describe("cache versioning", () => {
  const data = processGeometry(raw());
  it("fresh / stale / invalid", () => {
    const e: CacheEntry = { key: CACHE_KEY, createdAt: 1000, data };
    expect(entryUsability(e, 1000)).toBe("fresh");
    expect(entryUsability(e, 1000 + MAX_AGE_MS + 1)).toBe("stale");
    expect(entryUsability({ ...e, key: "geo3d:v0" }, 1000)).toBe("invalid");
    expect(entryUsability({ ...e, data: { ...data, version: PROCESSOR_VERSION + 1 } }, 1000)).toBe("invalid");
    expect(entryUsability(null, 1000)).toBe("invalid");
  });
});

describe("loader + worker fallback", () => {
  const data = () => processGeometry(raw());
  const mem = (e: CacheEntry | null = null) => { let v = e; const c: GeoCache = { get: async () => v, put: async (x) => { v = x; } }; return { c, read: () => v }; };
  it("uses a fresh cache without running the worker", async () => {
    const m = mem({ key: CACHE_KEY, createdAt: 0, data: data() });
    const worker = vi.fn();
    const r = await loadProcessed({ cache: m.c, worker, main: vi.fn(), now: () => 1 });
    expect(r.via).toBe("cache"); expect(worker).not.toHaveBeenCalled();
  });
  it("runs worker and stores the result", async () => {
    const m = mem();
    const r = await loadProcessed({ cache: m.c, worker: async () => data(), main: vi.fn(), now: () => 5 });
    expect(r.via).toBe("worker"); expect(m.read()?.createdAt).toBe(5);
  });
  it("falls back to main thread when the worker fails", async () => {
    const main = vi.fn(async () => data());
    const r = await loadProcessed({ cache: mem().c, worker: async () => { throw new Error("boom"); }, main, now: () => 1 });
    expect(r.via).toBe("main-thread"); expect(r.workerError).toBe("boom"); expect(main).toHaveBeenCalledOnce();
  });
  it("keeps a stale cache when both paths fail (offline)", async () => {
    const m = mem({ key: CACHE_KEY, createdAt: 0, data: data() });
    const r = await loadProcessed({ cache: m.c, worker: async () => { throw new Error("x"); }, main: async () => { throw new Error("offline"); }, now: () => MAX_AGE_MS + 10 });
    expect(r.via).toBe("cache");
  });
  it("throws when nothing is available", async () => {
    await expect(loadProcessed({ cache: mem().c, worker: async () => { throw new Error("x"); }, main: async () => { throw new Error("offline"); }, now: () => 1 })).rejects.toThrow("offline");
  });
});
