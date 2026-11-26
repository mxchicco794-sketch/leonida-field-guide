/// <reference lib="webworker" />
import { fetchJson } from "../api";
import { processGeometry, transferables } from "./process";
import { adaptRegions, globalTransfers } from "./regions";
import { readLegacyCache, regionalCache } from "./regional-cache";
import { MAX_AGE_MS } from "./cache";

/** Fetch + JSON.parse + triangulation all happen here, off the main thread. */
self.onmessage = async (event: MessageEvent<unknown>) => {
  try {
    const regional = typeof event.data === "object" && event.data !== null && "mode" in event.data && event.data.mode === "regional";
    const cached = regional ? await readLegacyCache() : null;
    const fresh = cached && Date.now() - cached.createdAt <= MAX_AGE_MS;
    if (regional && fresh) {
      const prepared = await regionalCache.stage(adaptRegions(cached.data, cached.createdAt), "migration");
      (self as unknown as Worker).postMessage({ ok: true, data: prepared }, globalTransfers(prepared.global));
      return;
    }
    try {
    const [land, surface, roads, rails] = await Promise.all(
      ["land", "surface", "roads", "rails"].map((n) => fetchJson<unknown>(`data/${n}.json`)),
    );
    if (!land || !surface || !roads || !rails) throw new Error("Incomplete geometry");
    const out = processGeometry({ land: land.data, surface: surface.data, roads: roads.data, rails: rails.data });
    if (regional) {
      const prepared = await regionalCache.stage(adaptRegions(out), "worker");
      (self as unknown as Worker).postMessage({ ok: true, data: prepared }, globalTransfers(prepared.global));
      return;
    }
    (self as unknown as Worker).postMessage({ ok: true, data: out }, transferables(out));
    } catch (e) {
      if (regional && cached && !(e instanceof Error && e.name === "RegionalIntegrityError")) {
        const prepared = await regionalCache.stage(adaptRegions(cached.data, cached.createdAt), "migration");
        (self as unknown as Worker).postMessage({ ok: true, data: prepared }, globalTransfers(prepared.global));
      } else throw e;
    }
  } catch (e) {
    (self as unknown as Worker).postMessage({ ok: false, error: e instanceof Error ? e.message : String(e), name: e instanceof Error ? e.name : "Error" });
  }
};
