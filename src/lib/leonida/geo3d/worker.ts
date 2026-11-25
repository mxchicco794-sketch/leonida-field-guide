/// <reference lib="webworker" />
import { fetchJson } from "../api";
import { processGeometry, transferables } from "./process";

/** Fetch + JSON.parse + triangulation all happen here, off the main thread. */
self.onmessage = async () => {
  try {
    const [land, surface, roads, rails] = await Promise.all(
      ["land", "surface", "roads", "rails"].map((n) => fetchJson<unknown>(`data/${n}.json`)),
    );
    const out = processGeometry({ land: land!.data, surface: surface!.data, roads: roads!.data, rails: rails!.data });
    (self as unknown as Worker).postMessage({ ok: true, data: out }, transferables(out));
  } catch (e) {
    (self as unknown as Worker).postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
