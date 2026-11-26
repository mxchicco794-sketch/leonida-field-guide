import { loadProcessed, runWorkerTask, type Loaded, type Stage } from "./load";
import { abortCheck, assertStaged, isFreshRegional, regionalCache, RegionalIntegrityError, type RegionalStore, type StagedRegional } from "./regional-cache";

export type SelectedGeometry = { mode: "legacy"; loaded: Loaded; reason?: string } | { mode: "regional"; prepared: StagedRegional; via: string };
interface Options { signal?: AbortSignal; onStage?: (stage: Stage) => void; store?: RegionalStore; worker?: (signal?: AbortSignal) => Promise<StagedRegional>; legacy?: typeof loadProcessed; now?: () => number }

export const runRegionalWorker = (signal?: AbortSignal) => runWorkerTask(signal, { mode: "regional" }, (value) => { assertStaged(value); return value; });

export async function loadRegional(options: Options = {}): Promise<SelectedGeometry> {
  const { signal, onStage, store = regionalCache, worker = runRegionalWorker, legacy = loadProcessed, now = Date.now } = options;
  const stage = (s: Stage) => { abortCheck(signal); onStage?.(s); };
  stage("checking-cache");
  let active: StagedRegional | null = null;
  try {
    active = await store.active(signal); abortCheck(signal);
    if (active && isFreshRegional(active, now())) { stage("loading-cache"); return { mode: "regional", prepared: active, via: "cache" }; }
    stage("processing");
    const prepared = await worker(signal); abortCheck(signal);
    await store.activate(prepared, signal); abortCheck(signal);
    return { mode: "regional", prepared, via: prepared.via };
  } catch (e) {
    abortCheck(signal);
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    if (e instanceof RegionalIntegrityError || (e instanceof Error && e.name === "RegionalIntegrityError")) throw e;
    if (active) { stage("loading-cache"); return { mode: "regional", prepared: active, via: "stale-cache" }; }
    stage("processing-fallback");
    const reason = e instanceof Error ? e.message : String(e);
    const loaded = await legacy({ ...(signal ? { signal } : {}), ...(onStage ? { onStage } : {}) });
    abortCheck(signal); return { mode: "legacy", loaded, reason };
  }
}