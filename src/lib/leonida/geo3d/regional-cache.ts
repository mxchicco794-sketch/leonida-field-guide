import { assertProcessed } from "./process";
import { CACHE_KEY, MAX_AGE_MS, type CacheEntry } from "./cache";
import { assertPrepared, assertRegion, type RegionalBundle, type RegionalPrepared, type RegionPayload } from "./regions";

export interface StagedRegional extends RegionalPrepared { cacheId: string; via: "worker" | "migration" | "cache" }
export interface RegionalStore {
  stage(bundle: RegionalBundle, via: "worker" | "migration", signal?: AbortSignal): Promise<StagedRegional>;
  activate(value: StagedRegional, signal?: AbortSignal): Promise<void>;
  active(signal?: AbortSignal): Promise<StagedRegional | null>;
  read(value: StagedRegional, id: string, signal?: AbortSignal): Promise<RegionPayload>;
}
export class RegionalIntegrityError extends Error { override name = "RegionalIntegrityError"; }
export const REGIONAL_DB = "leonida-geo3d-regional";
export const abortCheck = (signal?: AbortSignal) => { if (signal?.aborted) throw new DOMException("Regional loading cancelled", "AbortError"); };
const STORES = ["manifests", "global", "regions", "active"];
type Header = Omit<StagedRegional, "global">;

export function assertStaged(value: unknown): asserts value is StagedRegional {
  assertPrepared(value);
  const p = value as StagedRegional;
  if (typeof p.cacheId !== "string" || !p.cacheId || !["worker", "migration", "cache"].includes(p.via)) throw new RegionalIntegrityError("Invalid staged generation");
}
export const isFreshRegional = (p: StagedRegional, now = Date.now()) => now - p.manifest.createdAt <= MAX_AGE_MS;

function open(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(REGIONAL_DB, 1);
    r.onupgradeneeded = () => { for (const name of STORES) if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name); };
    r.onerror = () => reject(r.error); r.onblocked = () => reject(new Error("Regional cache upgrade blocked"));
    r.onsuccess = () => resolve(r.result);
  });
}

/** Resolves only on commit. Route abort rolls back in-flight activation/write transactions. */
function transaction<T>(stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction) => IDBRequest<T> | undefined, signal?: AbortSignal): Promise<T | undefined> {
  abortCheck(signal);
  return open().then((db) => new Promise((resolve, reject) => {
    if (signal?.aborted) { db.close(); reject(new DOMException("Regional cache cancelled", "AbortError")); return; }
    const tx = db.transaction(stores, mode);
    const cancel = () => { try { tx.abort(); } catch { /* A completed transaction has no pending publication. */ } };
    const cleanup = () => { signal?.removeEventListener("abort", cancel); db.close(); };
    let request: IDBRequest<T> | undefined;
    tx.oncomplete = () => { cleanup(); resolve(request?.result); };
    tx.onabort = () => { cleanup(); reject(signal?.aborted ? new DOMException("Regional cache cancelled", "AbortError") : tx.error ?? new Error("Regional transaction aborted")); };
    signal?.addEventListener("abort", cancel, { once: true });
    try { request = run(tx); } catch (e) { cancel(); cleanup(); reject(e); }
  }));
}
const get = <T,>(store: string, key: string, signal?: AbortSignal) => transaction<T>([store], "readonly", (tx) => tx.objectStore(store).get(key) as IDBRequest<T>, signal);

export const regionalCache: RegionalStore = {
  async stage(bundle, via, signal) {
    assertPrepared(bundle); abortCheck(signal);
    if (bundle.payloads.length !== bundle.manifest.regions.length) throw new RegionalIntegrityError("Incomplete regional generation");
    const byId = new Map(bundle.payloads.map((p) => [p.id, p]));
    for (const meta of bundle.manifest.regions) {
      const payload = byId.get(meta.id);
      if (!payload) throw new RegionalIntegrityError("Missing staged region");
      try { assertRegion(payload, meta); } catch (e) { throw new RegionalIntegrityError(String(e)); }
    }
    const cacheId = `${bundle.manifest.generation}:${crypto.randomUUID()}`;
    const header: Header = { cacheId, manifest: bundle.manifest, via };
    await transaction(["manifests", "global", "regions"], "readwrite", (tx) => {
      tx.objectStore("manifests").put(header, cacheId);
      tx.objectStore("global").put(bundle.global, cacheId);
      for (const payload of bundle.payloads) tx.objectStore("regions").put(payload, `${cacheId}/${payload.id}`);
      return undefined;
    }, signal);
    return { ...header, global: bundle.global };
  },
  async read(value, id, signal) {
    abortCheck(signal);
    const meta = value.manifest.regions.find((m) => m.id === id);
    if (!meta) throw new RegionalIntegrityError("Region absent from manifest");
    const payload = await get<RegionPayload>("regions", `${value.cacheId}/${id}`, signal);
    abortCheck(signal);
    if (!payload) throw new RegionalIntegrityError(`Missing region ${id}`);
    try { assertRegion(payload, meta); } catch (e) { throw new RegionalIntegrityError(`Corrupt region ${id}: ${String(e)}`); }
    return payload;
  },
  async activate(value, signal) {
    assertStaged(value);
    const header = await get<Header>("manifests", value.cacheId, signal);
    if (!header || JSON.stringify(header.manifest) !== JSON.stringify(value.manifest)) throw new RegionalIntegrityError("Staged manifest mismatch");
    // One record at a time; verification never retains a second complete near dataset.
    for (const meta of value.manifest.regions) { await regionalCache.read(value, meta.id, signal); abortCheck(signal); }
    await transaction(["active"], "readwrite", (tx) => tx.objectStore("active").put(value.cacheId, "current"), signal);
  },
  async active(signal) {
    const cacheId = await get<string>("active", "current", signal);
    if (!cacheId) return null;
    const header = await get<Header>("manifests", cacheId, signal);
    const global = await get<RegionalPrepared["global"]>("global", cacheId, signal);
    if (!header || !global) throw new RegionalIntegrityError("Incomplete active generation");
    const result: StagedRegional = { ...header, global, via: "cache" };
    try { assertStaged(result); } catch (e) { throw new RegionalIntegrityError(String(e)); }
    return result;
  },
};

/** Exact read-only legacy slot; never calls the legacy adapter's old-key deletion routine. */
export async function readLegacyCache(): Promise<CacheEntry | null> {
  if (typeof indexedDB === "undefined") return null;
  return new Promise((resolve) => {
    const r = indexedDB.open("leonida-geo3d", 1);
    r.onupgradeneeded = () => r.transaction?.abort(); // Do not create a legacy cache during migration.
    r.onerror = () => resolve(null);
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("processed")) { db.close(); resolve(null); return; }
      const q = db.transaction("processed").objectStore("processed").get(CACHE_KEY);
      q.onerror = () => { db.close(); resolve(null); };
      q.onsuccess = () => {
        db.close(); const entry = q.result as CacheEntry | undefined;
        try { if (entry?.key !== CACHE_KEY) { resolve(null); return; } assertProcessed(entry.data); resolve(entry); } catch { resolve(null); }
      };
    };
  });
}