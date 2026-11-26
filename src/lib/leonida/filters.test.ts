import { expect, it } from "vitest";
import { filterLocations } from "./filters";
import type { Kind, LeonidaLocation } from "./types";

const locations: LeonidaLocation[] = [
  { id: "a", x: 5, y: 5, name: "A", kind: "collectible" },
  { id: "b", x: 20, y: 20, name: "B", kind: "activity" },
  { id: "c", x: 5, y: 5, name: "C", kind: "unknown" },
];
const kindMap = new Map<string, Kind>([
  ["collectible", { key: "collectible", name: "Collectible", colour: "red", icon: "", group: "Collectibles" }],
  ["activity", { key: "activity", name: "Activity", colour: "green", icon: "", group: "Activities" }],
]);
const base = { groups: ["Collectibles" as const], kindMap, hideFound: false, found: [] };
it("filters by selected category groups without mutating source locations", () => {
  expect(filterLocations(locations, base).map((l) => l.id)).toEqual(["a"]);
  expect(locations).toHaveLength(3);
});
it("uses existing district polygon containment", () => {
  const district = { name: "Test", x: 5, y: 5, rings: [[[0, 0], [10, 0], [10, 10], [0, 10]]] as [number, number][][] };
  expect(filterLocations(locations, { ...base, groups: ["Activities"], district })).toEqual([]);
});
it("hides found IDs only when hideFound is enabled", () => {
  expect(filterLocations(locations, { ...base, found: ["a"], hideFound: true })).toEqual([]);
  expect(filterLocations(locations, { ...base, found: ["a"] }).map((l) => l.id)).toEqual(["a"]);
});
it("keeps a focused source location visible despite filters", () => {
  expect(filterLocations(locations, { ...base, groups: [], hideFound: true, found: ["b"], focusId: "b" }).map((l) => l.id)).toEqual(["b"]);
});
it("treats unknown kinds as Other", () => {
  expect(filterLocations(locations, { ...base, groups: ["Other"] }).map((l) => l.id)).toEqual(["c"]);
});