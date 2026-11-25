import { PROCESSOR_VERSION, type Processed } from "./process";

/** Processed geometry is versioned by processor version; source data refresh after MAX_AGE. */
export const CACHE_KEY = `geo3d:v${PROCESSOR_VERSION}`;
export const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
export interface CacheEntry { key: string; createdAt: number; data: Processed }
export interface GeoCache { get(): Promise<CacheEntry | null>; put(e: CacheEntry): Promise<void> }

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
const tx = <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) =>
  open().then((db) => new Promise<T>((res, rej) => {
    const q = fn(db.transaction(STORE, mode).objectStore(STORE));
    q.onsuccess = () => { res(q.result); db.close(); };
    q.onerror = () => { rej(q.error); db.close(); };
  }));

/** IndexedDB adapter: one slot; entries from older processor versions are deleted on read. */
export const idbCache: GeoCache = {
  async get() {
    if (typeof indexedDB === "undefined") return null;
    const keys = (await tx("readonly", (s) => s.getAllKeys())) as string[];
    for (const k of keys) if (k !== CACHE_KEY) await tx("readwrite", (s) => s.delete(k));
    return ((await tx("readonly", (s) => s.get(CACHE_KEY))) as CacheEntry | undefined) ?? null;
  },
  async put(e) {
    if (typeof indexedDB === "undefined") return;
    await tx("readwrite", (s) => s.put(e, e.key));
  },
};
