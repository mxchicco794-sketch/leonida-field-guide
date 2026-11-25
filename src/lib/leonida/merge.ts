// Vendored from Open GTA 6 Map (https://github.com/fbritoferreira/gta6, src/merge.ts), CC BY 4.0.
// Folds places.json entries that duplicate a locations.json entry into that location, exactly as the original map does.
type Spot = {
  id: string; kind?: string; name: string; type?: string; same_as?: string; x: number; y: number;
  area?: string; real_life?: string; service?: string;
};

const SAME_SPOT = 1;
const EXACT = 0.05;
const NEAR = 0.5;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words = (...s: (string | undefined)[]) =>
  new Set(norm(s.filter(Boolean).join(" ")).split(" ").filter((w) => w.length > 2 && w !== "the" && w !== "and").map((w) => w.replace(/s$/, "")));

export function mergePlaces<T extends Spot>(locations: T[], places: T[]) {
  const byName = new Map<string, T[]>();
  const byKind = new Map<string | undefined, T[]>();
  for (const l of locations) {
    const name = norm(l.name);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name)!.push(l);
    if (!byKind.has(l.kind)) byKind.set(l.kind, []);
    byKind.get(l.kind)!.push(l);
  }
  const out = new Map(locations.map((l) => [l.id, { ...l }]));
  const merged = new Map<string, string>();
  const kept: T[] = [];
  for (const p of places) {
    const dist = (l: T) => Math.hypot(l.x - p.x, l.y - p.y);
    const said = p.same_as ? locations.find((l) => l.id === p.same_as) : undefined;
    const placeWords = words(p.name, p.service);
    const twin =
      said ??
      (byName.get(norm(p.name)) ?? []).filter((l) => dist(l) < SAME_SPOT).sort((a, b) => dist(a) - dist(b))[0] ??
      byKind.get(p.kind)?.find((l) => dist(l) < EXACT) ??
      byKind.get(p.kind)?.filter((l) => dist(l) < NEAR && [...words(l.name, l.type)].some((w) => placeWords.has(w))).sort((a, b) => dist(a) - dist(b))[0];
    if (!twin) { kept.push(p); continue; }
    const l = out.get(twin.id)!;
    const area = p.area || l.area;
    if (area) l.area = area;
    if (!l.real_life && p.real_life) l.real_life = p.real_life;
    if (!l.service && p.service) l.service = p.service;
    merged.set(p.id, twin.id);
  }
  return { items: [...kept, ...out.values()], merged };
}
