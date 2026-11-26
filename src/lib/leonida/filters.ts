import { inRings } from "./cluster";
import type { District, Group, Kind, LeonidaLocation } from "./types";

/** 3D-only adapter. The protected 2D view retains its existing filter implementation. */
export function filterLocations(locations: LeonidaLocation[], options: {
  groups: Group[]; kindMap: Map<string, Kind>; district?: District | undefined;
  hideFound: boolean; found: readonly string[]; focusId?: string | undefined;
}): LeonidaLocation[] {
  const found = options.hideFound ? new Set(options.found) : null;
  return locations.filter((loc) => loc.id === options.focusId || (
    options.groups.includes(options.kindMap.get(loc.kind)?.group ?? "Other") &&
    (!options.district || inRings(loc.x, loc.y, options.district.rings)) && !found?.has(loc.id)
  ));
}