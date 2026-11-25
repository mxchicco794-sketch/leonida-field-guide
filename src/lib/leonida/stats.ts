import type { Kind, LeonidaLocation } from "./types";

export interface KindProgress { kind: Kind; total: number; found: number }

/** Per-category totals for one group, computed from real data only. */
export function groupProgress(locations: LeonidaLocation[], kinds: Kind[], group: string, found: string[]): KindProgress[] {
  const f = new Set(found);
  return kinds
    .filter((k) => k.group === group)
    .map((kind) => {
      const items = locations.filter((l) => l.kind === kind.key);
      return { kind, total: items.length, found: items.filter((l) => f.has(l.id)).length };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
}
