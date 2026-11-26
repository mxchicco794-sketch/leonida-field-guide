import { expect, it, vi } from "vitest";
import { processGeometry } from "./process";
import { adaptRegions } from "./regions";
import { RegionStream } from "./region-stream";

const bundle = () => adaptRegions(processGeometry({
  land: [[[[300, 300], [700, 300], [700, 700], [300, 700]]]], surface: { features: [] }, rails: { features: [] },
  roads: { features: [{ properties: { kind: "main" }, geometry: { type: "LineString", coordinates: [[310, 310], [390, 390], [470, 310], [550, 390], [630, 310]] } }] },
}));
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
it("deduplicates reads, installs one region per frame and disposes only owned resources", async () => {
  const b = bundle(), dispose = vi.fn(), install = vi.fn((payload) => ({ resource: payload.id as string, bytes: 100 }));
  const read = vi.fn(async (id: string) => { const p = b.payloads.find((r) => r.id === id); if (!p) throw new Error("Missing"); return p; });
  const stream = new RegionStream({ manifest: b.manifest, read, install, dispose });
  const ids = b.manifest.regions.map((r) => r.id);
  expect(ids.length).toBeGreaterThan(2);
  stream.demand(ids, [], 0); stream.demand(ids, [], 0); await flush();
  stream.frame(0); expect(install).toHaveBeenCalledTimes(1);
  stream.frame(1); expect(install).toHaveBeenCalledTimes(2);
  for (let i = 0; i < ids.length; i++) { await flush(); stream.frame(i + 2); }
  expect(stream.ready).toBe(true); expect(read).toHaveBeenCalledTimes(ids.length);
  stream.dispose(); expect(dispose).toHaveBeenCalledTimes(ids.length);
  expect(stream.snapshot().cpuBytes).toBe(0);
});
it("never budget-evicts visible coverage and evicts offscreen buffers after retention", async () => {
  const b = bundle(), dispose = vi.fn();
  const stream = new RegionStream({ manifest: b.manifest,
    read: async (id) => { const p = b.payloads.find((r) => r.id === id); if (!p) throw new Error("Missing"); return p; },
    install: (p) => ({ resource: p.id, bytes: 2 * 1024 * 1024 }), dispose });
  const id = b.manifest.regions[0]?.id; if (!id) throw new Error("Missing");
  stream.demand([id], [], 0); await flush(); stream.frame(0); stream.frame(10000);
  expect(dispose).not.toHaveBeenCalled();
  stream.demand([], [], 10001); expect(dispose).toHaveBeenCalledWith(id);
  expect(stream.snapshot().cpuBytes).toBe(0);
});
it("cancels pending requests and prevents stale arrivals from installing", async () => {
  const b = bundle(), install = vi.fn(); let resolve: (p: (typeof b.payloads)[number]) => void = () => {};
  let signal: AbortSignal | null = null;
  const stream = new RegionStream({ manifest: b.manifest, read: (_id, s) => { signal = s; return new Promise((r) => { resolve = r; }); }, install, dispose: vi.fn() });
  const p = b.payloads[0]; if (!p) throw new Error("Missing");
  stream.demand([p.id], [], 0); stream.dispose();
  expect((signal as AbortSignal | null)?.aborted).toBe(true);
  resolve(p); await flush(); stream.frame(1);
  expect(install).not.toHaveBeenCalled(); expect(stream.snapshot().prepared).toBe(0);
});
it("stops and releases resources on corrupt payload rather than drawing it", async () => {
  const b = bundle(), p = b.payloads[0]; if (!p) throw new Error("Missing");
  const install = vi.fn();
  const stream = new RegionStream({ manifest: b.manifest, read: async () => ({ id: p.id, mesh: { position: new Float32Array([0, 0, 0]), index: new Uint32Array([0, 0, 0]) } }), install, dispose: vi.fn() });
  stream.demand([p.id], [], 0); await flush();
  expect(stream.error).not.toBeNull(); expect(stream.snapshot().cpuBytes).toBe(0); expect(install).not.toHaveBeenCalled();
});
it("never starts more than two concurrent reads", async () => {
  const b = bundle(); let active = 0, peak = 0;
  const completions: (() => void)[] = [];
  const stream = new RegionStream({ manifest: b.manifest,
    read: (id) => { active++; peak = Math.max(peak, active); return new Promise((resolve) => { completions.push(() => { active--; const p = b.payloads.find((r) => r.id === id); if (!p) throw new Error("Missing"); resolve(p); }); }); },
    install: (p) => ({ resource: p.id, bytes: 0 }), dispose: vi.fn() });
  stream.demand(b.manifest.regions.map((r) => r.id), [], 0);
  expect(active).toBe(2);
  completions.shift()?.(); await flush();
  expect(peak).toBe(2); expect(active).toBe(2);
  stream.dispose(); completions.forEach((complete) => complete()); await flush();
});