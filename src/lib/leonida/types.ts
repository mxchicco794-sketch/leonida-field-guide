export type Group = "Collectibles" | "Activities" | "Crime" | "Places" | "Other";

export interface Kind { key: string; name: string; colour: string; icon: string; group: Group; pinnable?: boolean }
export interface Categories { groups: Group[]; kinds: Kind[] }

/** An entry from data/locations.json or data/places.json (map units: x right, y down). */
export interface LeonidaLocation {
  id: string;
  kind: string;
  x: number;
  y: number;
  name: string;
  type?: string;
  description?: string;
  screenshot?: string | null;
  area?: string;
  region?: string;
  real_life?: string;
  service?: string;
  same_as?: string;
  confidence?: string;
  source_urls?: string[];
}

/** data/districts.json: outline rings of [x, y] map units plus a label point. */
export interface District { name: string; x: number; y: number; rings: [number, number][][] }
/** data/routes.json: route shield labels. */
export interface RouteShield { ref: string; kind: string; x: number; y: number }

export interface Dataset {
  categories: Categories;
  /** locations.json merged with places.json, as the original map does. */
  locations: LeonidaLocation[];
  districts: District[];
  routes: RouteShield[];
  syncedAt: number;
  source: "network" | "cache";
}

type Pos = [number, number];
export interface GeoFeature { type: "Feature"; properties: Record<string, string>; geometry: { type: string; coordinates: unknown } }
export interface FeatureCollection { type: "FeatureCollection"; features: GeoFeature[] }
/** Heavy geometry (land, surface, roads, rails), loaded only when the vector overlay is turned on. */
export interface Geometry { land: Pos[][][]; surface: FeatureCollection; roads: FeatureCollection; rails: FeatureCollection }
