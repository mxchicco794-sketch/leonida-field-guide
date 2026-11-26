import { fetchJson } from "../api";
import { CACHE_KEY, entryUsability, idbCache, type GeoCache } from "./cache";
import { assertProcessed, processGeometry, type Processed } from "./process";

export const WORKER_TIMEOUT_MS = 60_000;
export type Via = "cache" | "worker" | "main-thread";
export interface Loaded { data: Processed; via: Via; workerError?: string }

const abortError = () => new DOMException("Map loading cancelled", "AbortError");
const isAbort = (e: unknown) => typeof e === "object" && e !== null && "name" in e && e.name === "AbortError";
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw abortError(); }

/** Reject promptly even when a cache adapter or injected dependency cannot abort itself. */
function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(abortError()); };
    signal.addEventListener("abort", abort, { once: true });
    work.then((value) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(abortError()); else resolve(value);
    }, (error: unknown) => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
  });
}

/** One startup message; every terminal path releases listeners, timer and worker. */
export function runWorker(signal?: AbortSignal): Promise<Processed> {
  return new Promise((resolve, reject) => {
    checkAbort(signal);
    if (typeof Worker === "undefined") { reject(new Error("Web Workers unavailable")); return; }
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    let settled = false;
    const finish = (result: { data: Processed } | { error: unknown }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      w.removeEventListener("message", message);
      w.removeEventListener("error", error);
      w.removeEventListener("messageerror", messageerror);
      signal?.removeEventListener("abort", abort);
      w.terminate();
      if ("error" in result) reject(result.error); else resolve(result.data);
    };
    const abort = () => finish({ error: abortError() });
    const error = (e: ErrorEvent) => finish({ error: new Error(e.message || "Worker crashed") });
    const messageerror = () => finish({ error: new Error("Worker message could not be decoded") });
    const message = (e: MessageEvent<unknown>) => {
      if (signal?.aborted) { abort(); return; }
      try {
        const msg = e.data;
        if (typeof msg !== "object" || msg === null || !("ok" in msg)) throw new Error("Malformed Worker message");
        if (msg.ok === false) {
          if ("error" in msg && typeof msg.error !== "string") throw new Error("Malformed Worker error");
          throw new Error("error" in msg ? String(msg.error) : "Worker failed");
        }
        if (msg.ok !== true || !("data" in msg)) throw new Error("Unexpected Worker message");
        const data = msg.data as Processed;
        assertProcessed(data);
        finish({ data });
      } catch (e) { finish({ error: e }); }
    };
    const timer = setTimeout(() => finish({ error: new Error("Worker timed out") }), WORKER_TIMEOUT_MS);
    w.addEventListener("message", message);
    w.addEventListener("error", error);
    w.addEventListener("messageerror", messageerror);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { w.postMessage({}); } catch (e) { finish({ error: e }); }
  });
}

/** Fallback: same pipeline on the main thread (only used if the worker fails). */
export async function runMainThread(signal?: AbortSignal): Promise<Processed> {
  checkAbort(signal);
  const [land, surface, roads, rails] = await Promise.all(["land", "surface", "roads", "rails"].map((n) => fetchJson<unknown>(`data/${n}.json`, signal)));
  checkAbort(signal);
  if (!land || !surface || !roads || !rails) throw new Error("Incomplete map geometry");
  const data = processGeometry({ land: land.data, surface: surface.data, roads: roads.data, rails: rails.data });
  checkAbort(signal);
  return data;
}

export type Stage = "checking-cache" | "loading-cache" | "processing" | "processing-fallback";
export interface Deps { cache: GeoCache; worker: (signal?: AbortSignal) => Promise<Processed>; main: (signal?: AbortSignal) => Promise<Processed>; now: () => number; onStage?: (s: Stage) => void; signal?: AbortSignal }

export async function loadProcessed(opts: Partial<Deps> = {}): Promise<Loaded> {
  const d: Deps = { cache: idbCache, worker: runWorker, main: runMainThread, now: Date.now, ...opts };
  const stage = (x: Stage) => { checkAbort(d.signal); d.onStage?.(x); };
  stage("checking-cache");
  const cached = await abortable(d.cache.get().catch(() => null), d.signal);
  checkAbort(d.signal);
  const use = entryUsability(cached, d.now());
  const safe = (p: Processed) => { try { assertProcessed(p); return true; } catch { return false; } };
  if (cached && use === "fresh" && safe(cached.data)) { stage("loading-cache"); checkAbort(d.signal); return { data: cached.data, via: "cache" }; }
  stage("processing");

  let data: Processed, via: Via, workerError: string | undefined;
  try {
    checkAbort(d.signal);
    data = await abortable(d.worker(d.signal), d.signal); checkAbort(d.signal); assertProcessed(data); via = "worker";
  } catch (e) {
    if (d.signal?.aborted || isAbort(e)) throw abortError();
    workerError = e instanceof Error ? e.message : String(e);
    stage("processing-fallback");
    try { checkAbort(d.signal); data = await abortable(d.main(d.signal), d.signal); checkAbort(d.signal); assertProcessed(data); via = "main-thread"; }
    catch (e2) {
      if (d.signal?.aborted || isAbort(e2)) throw abortError();
      if (cached && use === "stale" && safe(cached.data)) return { data: cached.data, via: "cache", workerError }; // offline: keep last good copy
      throw e2;
    }
  }
  checkAbort(d.signal);
  await abortable(d.cache.put({ key: CACHE_KEY, createdAt: d.now(), data }, d.signal).catch((e: unknown) => {
    if (d.signal?.aborted || isAbort(e)) throw abortError();
  }), d.signal);
  checkAbort(d.signal);
  return workerError ? { data, via, workerError } : { data, via };
}
