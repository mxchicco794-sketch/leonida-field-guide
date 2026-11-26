import { PROCESSOR_VERSION, type Processed } from "./process";

/** Processed geometry is versioned by processor version; source data refresh after MAX_AGE. */
export const CACHE_KEY = `geo3d:v${PROCESSOR_VERSION}`;
export const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
export interface CacheEntry { key: string; createdAt: number; data: Processed }
export interface GeoCache { get(): Promise<CacheEntry | null>; put(e: CacheEntry, signal?: AbortSignal): Promise<void> }

export type Usability = "fresh" | "stale" | "invalid";
export function entryUsability(e: CacheEntry | null | undefined, now: number, key = CACHE_KEY): Usability {
  if (!e || e.key !== key || e.data?.version !== PROCESSOR_VERSION) return "invalid";
  return now - e.createdAt > MAX_AGE_MS ? "stale" : "fresh";
}

const DB = "leonida-geo3d", STORE = "processed";
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const tx = <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, signal?: AbortSignal) =>
  open().then((db) => new Promise<T>((res, rej) => {
    if (signal?.aborted) { db.close(); rej(new DOMException("Map cache write cancelled", "AbortError")); return; }
    const transaction = db.transaction(STORE, mode);
    const abort = () => transaction.abort();
    const cleanup = () => { signal?.removeEventListener("abort", abort); db.close(); };
    transaction.oncomplete = () => { cleanup(); res(q.result); };
    transaction.onabort = () => { cleanup(); rej(signal?.aborted ? new DOMException("Map cache write cancelled", "AbortError") : transaction.error ?? new Error("Map cache transaction aborted")); };
    transaction.onerror = () => { /* onabort settles the failed transaction. */ };
    signal?.addEventListener("abort", abort, { once: true });
    const q = fn(transaction.objectStore(STORE));
  }));

/** IndexedDB adapter: one slot; entries from older processor versions are deleted on read. */
export const idbCache: GeoCache = {
  async get() {
    if (typeof indexedDB === "undefined") return null;
    const keys = (await tx("readonly", (s) => s.getAllKeys())) as string[];
    for (const k of keys) if (k !== CACHE_KEY) await tx("readwrite", (s) => s.delete(k));
    return ((await tx("readonly", (s) => s.get(CACHE_KEY))) as CacheEntry | undefined) ?? null;
  },
  async put(e, signal) {
    if (signal?.aborted) throw new DOMException("Map cache write cancelled", "AbortError");
    if (typeof indexedDB === "undefined") return;
    await tx("readwrite", (s) => s.put(e, e.key), signal);
  },
};
