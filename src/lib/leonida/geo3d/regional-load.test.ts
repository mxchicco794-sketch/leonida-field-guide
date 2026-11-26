import { describe, expect, it, vi } from "vitest";
import { processGeometry } from "./process";
import { adaptRegions } from "./regions";
import { loadRegional } from "./regional-load";
import { RegionalIntegrityError, type RegionalStore, type StagedRegional } from "./regional-cache";
import { MAX_AGE_MS } from "./cache";
import { QueryClient, onlineManager } from "@tanstack/react-query";

const staged = (createdAt = 0): StagedRegional => {
  const bundle = adaptRegions(processGeometry({ land: [[[[300, 300], [310, 300], [310, 310], [300, 310]]]], surface: { features: [] }, roads: { features: [] }, rails: { features: [] } }), createdAt);
  return { global: bundle.global, manifest: bundle.manifest, cacheId: "test-generation", via: "worker" };
};
function store(active: StagedRegional | null = null): RegionalStore {
  return { active: vi.fn(async () => active), activate: vi.fn(async () => {}), stage: vi.fn(), read: vi.fn() };
}
describe("regional loader gate", () => {
  it("uses the fresh regional cache without a worker", async () => {
    const worker = vi.fn(), result = await loadRegional({ store: store(staged()), now: () => 1, worker });
    expect(result.mode).toBe("regional"); expect(worker).not.toHaveBeenCalled();
  });
  it("activates a cold worker result and forwards cancellation", async () => {
    const controller = new AbortController(), cache = store(), prepared = staged();
    const worker = vi.fn(async () => prepared);
    const result = await loadRegional({ store: cache, worker, signal: controller.signal });
    expect(result.mode).toBe("regional");
    expect(worker).toHaveBeenCalledWith(controller.signal);
    expect(cache.activate).toHaveBeenCalledWith(prepared, controller.signal);
  });
  it("preserves a stale last-good generation when offline", async () => {
    const legacy = vi.fn();
    const result = await loadRegional({ store: store(staged()), now: () => MAX_AGE_MS + 1, worker: async () => { throw new Error("offline"); }, legacy });
    expect(result.mode === "regional" && result.via).toBe("stale-cache"); expect(legacy).not.toHaveBeenCalled();
  });
  it("stops on integrity failure rather than silently falling back", async () => {
    const legacy = vi.fn();
    await expect(loadRegional({ store: store(), worker: async () => { throw new RegionalIntegrityError("bad ownership"); }, legacy })).rejects.toThrow("bad ownership");
    expect(legacy).not.toHaveBeenCalled();
  });
  it("does not activate or fall back after cancellation", async () => {
    const controller = new AbortController(), cache = store(), legacy = vi.fn();
    await expect(loadRegional({ store: cache, signal: controller.signal, worker: async () => { controller.abort(); return staged(); }, legacy })).rejects.toMatchObject({ name: "AbortError" });
    expect(cache.activate).not.toHaveBeenCalled(); expect(legacy).not.toHaveBeenCalled();
  });
  it("can read a saved generation through the query while the browser is offline", async () => {
    const client = new QueryClient(); onlineManager.setOnline(false);
    try {
      const worker = vi.fn();
      const result = await client.fetchQuery({ queryKey: ["regional-offline"], networkMode: "always", retry: false,
        queryFn: ({ signal }) => loadRegional({ store: store(staged()), now: () => 1, worker, signal }) });
      expect(result.mode).toBe("regional"); expect(worker).not.toHaveBeenCalled();
    } finally { onlineManager.setOnline(true); client.clear(); }
  });
});