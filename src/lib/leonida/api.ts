import { mergePlaces } from "./merge";
import type { Categories, Dataset, District, Geometry, LeonidaLocation, RouteShield } from "./types";

/** Open GTA 6 Map — https://github.com/fbritoferreira/gta6 (CC BY 4.0). */
export const DATA_BASE = "https://fbritoferreira.github.io/gta6";
export const SOURCE_REPO = "https://github.com/fbritoferreira/gta6";
export const TILE_URL = (style: "night" | "day") => `${DATA_BASE}/tiles/${style}/{z}/{z},{y},{x}.webp`;
/** Original map extent in Leaflet lat/lng (lat = -y, lng = x), from the source map.ts. */
export const MAP_BOUNDS: [[number, number], [number, number]] = [[-800, 160], [-160, 832]];
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
  const [cats, locs, places, districts, routes] = await Promise.all([
    fetchJson<Categories>("data/categories.json"),
    fetchJson<LeonidaLocation[]>("data/locations.json"),
    fetchJson<LeonidaLocation[]>("data/places.json"),
    fetchJson<District[]>("data/districts.json"),
    fetchJson<RouteShield[]>("data/routes.json"),
  ]);
  const fromCache = [cats, locs, places, districts, routes].some((r) => r.fromCache);
  let syncedAt = Date.now();
  if (fromCache) syncedAt = Number(localStorage.getItem(META_KEY) ?? 0);
  else localStorage.setItem(META_KEY, String(syncedAt));
  const known = new Set(cats.data.kinds.map((k) => k.key));
  const { items } = mergePlaces(locs.data, places.data);
  return {
    categories: cats.data,
    locations: items.filter((l) => known.has(l.kind)),
    districts: districts.data,
    routes: routes.data,
    syncedAt,
    source: fromCache ? "cache" : "network",
  };
}

export async function loadGeometry(): Promise<Geometry> {
  const [land, surface, roads, rails] = await Promise.all([
    fetchJson<Geometry["land"]>("data/land.json"),
    fetchJson<Geometry["surface"]>("data/surface.json"),
    fetchJson<Geometry["roads"]>("data/roads.json"),
    fetchJson<Geometry["rails"]>("data/rails.json"),
  ]);
  return { land: land.data, surface: surface.data, roads: roads.data, rails: rails.data };
}
