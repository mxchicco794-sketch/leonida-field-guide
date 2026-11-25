export type Group = "Collectibles" | "Activities" | "Crime" | "Places" | "Other";

export interface Kind {
  key: string;
  name: string;
  colour: string;
  icon: string;
  group: Group;
  pinnable?: boolean;
}

export interface Categories {
  groups: Group[];
  kinds: Kind[];
}

export interface LeonidaLocation {
  id: string;
  kind: string;
  x: number;
  y: number;
  name: string;
  type?: string;
  description?: string;
  screenshot?: string;
  area?: string;
  region?: string;
  confidence?: string;
  source_urls?: string[];
}

export interface Dataset {
  categories: Categories;
  locations: LeonidaLocation[];
  syncedAt: number;
  source: "network" | "cache";
}
