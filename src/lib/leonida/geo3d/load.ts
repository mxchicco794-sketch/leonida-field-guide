import { fetchJson } from "../api";
import { CACHE_KEY, entryUsability, idbCache, type GeoCache } from "./cache";
import { assertProcessed, processGeometry, type Processed } from "./process";

export const WORKER_TIMEOUT_MS = 60_000;
export type Via = "cache" | "worker" | "main-thread";
export interface Loaded { data: Processed; via: Via; workerError?: string }

/** Web Worker run; rejects on error, bad message or timeout. */
export function runWorker(): Promise<Processed> {
  return new Promise((res, rej) => {
    if (typeof Worker === "undefined") return rej(new Error("Web Workers unavailable"));
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    const t = setTimeout(() => { w.terminate(); rej(new Error("Worker timed out")); }, WORKER_TIMEOUT_MS);
    w.onmessage = (e: MessageEvent<{ ok: boolean; data?: Processed; error?: string }>) => {
      clearTimeout(t); w.terminate();
      if (e.data.ok && e.data.data) res(e.data.data); else rej(new Error(e.data.error ?? "Worker failed"));
    };
    w.onerror = (e) => { clearTimeout(t); w.terminate(); rej(new Error(e.message || "Worker crashed")); };
  });
}

/** Fallback: same pipeline on the main thread (only used if the worker fails). */
export async function runMainThread(): Promise<Processed> {
  const [land, surface, roads, rails] = await Promise.all(["land", "surface", "roads", "rails"].map((n) => fetchJson<unknown>(`data/${n}.json`)));
  return processGeometry({ land: land!.data, surface: surface!.data, roads: roads!.data, rails: rails!.data });
}

export type Stage = "checking-cache" | "loading-cache" | "processing" | "processing-fallback";
export interface Deps { cache: GeoCache; worker: () => Promise<Processed>; main: () => Promise<Processed>; now: () => number; onStage?: (s: Stage) => void }

export async function loadProcessed(opts: Partial<Deps> = {}): Promise<Loaded> {
  const d: Deps = { cache: idbCache, worker: runWorker, main: runMainThread, now: Date.now, ...opts };
  const stage = (x: Stage) => d.onStage?.(x);
  stage("checking-cache");
  const cached = await d.cache.get().catch(() => null);
  const use = entryUsability(cached, d.now());
  const safe = (p: Processed) => { try { assertProcessed(p); return true; } catch { return false; } };
  if (use === "fresh" && safe(cached!.data)) { stage("loading-cache"); return { data: cached!.data, via: "cache" }; }
  stage("processing");

  let data: Processed, via: Via, workerError: string | undefined;
  try {
    data = await d.worker(); assertProcessed(data); via = "worker";
  } catch (e) {
    workerError = e instanceof Error ? e.message : String(e);
    stage("processing-fallback");
    try { data = await d.main(); via = "main-thread"; }
    catch (e2) {
      if (use === "stale" && safe(cached!.data)) return { data: cached!.data, via: "cache", workerError }; // offline: keep last good copy
      throw e2;
    }
  }
  await d.cache.put({ key: CACHE_KEY, createdAt: d.now(), data }).catch(() => {});
  return workerError ? { data, via, workerError } : { data, via };
}
