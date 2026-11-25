import type { Categories, Dataset, LeonidaLocation } from "./types";

/** Open GTA 6 Map — https://github.com/fbritoferreira/gta6 (CC BY 4.0). */
export const DATA_BASE = "https://fbritoferreira.github.io/gta6";
export const SOURCE_REPO = "https://github.com/fbritoferreira/gta6";
export const TILE_URL = (style: "night" | "day") => `${DATA_BASE}/tiles/${style}/{z}/{z},{y},{x}.webp`;
export const assetUrl = (path: string) => `${DATA_BASE}/${path.replace(/^\//, "")}`;

const CACHE_NAME = "leonida-data-v1";
const META_KEY = "leonida:syncedAt";

/** Network-first fetch that falls back to the browser Cache Storage copy when offline. */
async function fetchJson<T>(path: string): Promise<{ data: T; fromCache: boolean }> {
  const url = assetUrl(path);
  const cache = typeof caches !== "undefined" ? await caches.open(CACHE_NAME) : null;
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    await cache?.put(url, res.clone());
    return { data: (await res.json()) as T, fromCache: false };
  } catch (err) {
    const hit = await cache?.match(url);
    if (hit) return { data: (await hit.json()) as T, fromCache: true };
    throw err;
  }
}

export async function loadDataset(): Promise<Dataset> {
  const [cats, locs] = await Promise.all([
    fetchJson<Categories>("data/categories.json"),
    fetchJson<LeonidaLocation[]>("data/locations.json"),
  ]);
  const fromCache = cats.fromCache || locs.fromCache;
  let syncedAt = Date.now();
  if (fromCache) syncedAt = Number(localStorage.getItem(META_KEY) ?? 0);
  else localStorage.setItem(META_KEY, String(syncedAt));
  return {
    categories: cats.data,
    locations: locs.data,
    syncedAt,
    source: fromCache ? "cache" : "network",
  };
}
