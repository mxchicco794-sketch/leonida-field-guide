import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processGeometry } from "./process";
import { adaptRegions } from "./regions";
import { readLegacyCache, regionalCache, REGIONAL_DB } from "./regional-cache";

/** Transactional IndexedDB double; committed records are separate from pending writes. */
const databases = new Map<string, Map<string, Map<string, unknown>>>();
// Node structuredClone returns Node-realm arrays, unlike browser IndexedDB's caller-realm arrays.
function clone(value: unknown): unknown {
  if (value instanceof Float32Array) return new Float32Array(value);
  if (value instanceof Uint32Array) return new Uint32Array(value);
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
  return value;
}
function installDatabase() {
  vi.stubGlobal("indexedDB", { open: (name: string) => {
    let stores = databases.get(name); const fresh = !stores;
    if (!stores) { stores = new Map(); databases.set(name, stores); }
    const data = stores;
    const db = {
      objectStoreNames: { contains: (key: string) => data.has(key) },
      createObjectStore: (key: string) => data.set(key, new Map()), close: vi.fn(),
      transaction: (_names: string[] | string, _mode?: string) => {
        let aborted = false; const writes: (() => void)[] = [];
        const tx = {
          oncomplete: null as (() => void) | null, onabort: null as (() => void) | null, error: null,
          abort: () => { aborted = true; queueMicrotask(() => tx.onabort?.()); },
          objectStore: (key: string) => {
            const store = data.get(key); if (!store) throw new Error("Missing fake store");
            return {
              put: (value: unknown, id: string) => { const copy = clone(value); writes.push(() => store.set(id, copy)); return { result: id }; },
              get: (id: string) => { const r = { result: clone(store.get(id)), onsuccess: null as (() => void) | null, onerror: null as (() => void) | null }; queueMicrotask(() => r.onsuccess?.()); return r; },
            };
          },
        };
        setTimeout(() => { if (!aborted) { writes.forEach((write) => write()); tx.oncomplete?.(); } }, 0);
        return tx;
      },
    };
    const r = { result: db, transaction: { abort: () => { databases.delete(name); queueMicrotask(() => r.onerror?.()); } }, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null, onupgradeneeded: null as (() => void) | null };
    queueMicrotask(() => { if (fresh) r.onupgradeneeded?.(); if (databases.has(name)) r.onsuccess?.(); });
    return r;
  } });
}
const fixture = () => adaptRegions(processGeometry({ land: [[[[300, 300], [400, 300], [400, 400], [300, 400]]]], surface: { features: [] }, roads: { features: [{ properties: { kind: "main" }, geometry: { type: "LineString", coordinates: [[310, 310], [390, 310]] } }] }, rails: { features: [] } }), 0);
beforeEach(() => { databases.clear(); installDatabase(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("additive regional cache gate", () => {
  it("does not activate a staged generation until integrity verification succeeds", async () => {
    const stage = await regionalCache.stage(fixture(), "worker");
    expect(await regionalCache.active()).toBeNull();
    await regionalCache.activate(stage);
    const active = await regionalCache.active();
    expect(active?.cacheId).toBe(stage.cacheId);
    const id = stage.manifest.regions[0]?.id; if (!id) throw new Error("Missing region");
    expect((await regionalCache.read(stage, id)).id).toBe(id);
  });
  it("keeps the previous generation active if a new region is missing or corrupt", async () => {
    const old = await regionalCache.stage(fixture(), "worker"); await regionalCache.activate(old);
    const next = await regionalCache.stage(fixture(), "worker");
    const id = next.manifest.regions[0]?.id; if (!id) throw new Error("Missing region");
    databases.get(REGIONAL_DB)?.get("regions")?.delete(`${next.cacheId}/${id}`);
    await expect(regionalCache.activate(next)).rejects.toThrow("Missing region");
    expect((await regionalCache.active())?.cacheId).toBe(old.cacheId);
    const another = await regionalCache.stage(fixture(), "worker");
    const record = databases.get(REGIONAL_DB)?.get("regions")?.get(`${another.cacheId}/${id}`) as { mesh: { position: Float32Array } };
    record.mesh.position[0] = 99;
    await expect(regionalCache.activate(another)).rejects.toThrow("Corrupt region");
    expect((await regionalCache.active())?.cacheId).toBe(old.cacheId);
  });
  it("aborted activation never publishes the cancelled generation", async () => {
    const stage = await regionalCache.stage(fixture(), "worker"); const controller = new AbortController();
    const task = regionalCache.activate(stage, controller.signal);
    controller.abort();
    await expect(task).rejects.toMatchObject({ name: "AbortError" });
    expect(await regionalCache.active()).toBeNull();
  });
  it("reads v4 without changing or deleting the legacy record", async () => {
    const p = processGeometry({ land: [[[[300, 300], [400, 300], [400, 400], [300, 400]]]], surface: { features: [] }, roads: { features: [] }, rails: { features: [] } });
    const entry = { key: "geo3d:v4", createdAt: 123, data: p };
    databases.set("leonida-geo3d", new Map([["processed", new Map([["geo3d:v4", entry]])]]));
    const legacy = await readLegacyCache(); expect(legacy?.createdAt).toBe(123);
    expect(databases.get("leonida-geo3d")?.get("processed")?.get("geo3d:v4")).toBe(entry);
  });
});