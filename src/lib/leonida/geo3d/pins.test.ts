import { expect, it } from "vitest";
import { clusterPins, pinPosition, pinZoomStep, tapGrid, TapGesture } from "./pins";
const locations = [
  { id: "a", x: 496, y: 480, kind: "test", name: "A" },
  { id: "b", x: 496.5, y: 480.5, kind: "test", name: "B" },
];
it("converts source coordinates to the existing centered world with no footprint changes", () => {
  expect(pinPosition(locations[0] ?? { x: 0, y: 0 })).toEqual([0, 1.4, 0]);
  expect(pinPosition({ x: 500, y: 470 })).toEqual([4, 1.4, -10]);
});
it("clusters at far zoom and separates at zoom 5 with every ID preserved", () => {
  const far = clusterPins(locations, 0);
  expect(far).toHaveLength(1);
  expect(far[0]?.type === "cluster" && far[0].items.map((l) => l.id)).toEqual(["a", "b"]);
  expect(clusterPins(locations, 5).map((c) => c.type === "single" && c.item.id)).toEqual(["a", "b"]);
});
it("keeps a focused pin individually tappable at far zoom", () => {
  expect(clusterPins(locations, 0, "b").some((c) => c.type === "single" && c.item.id === "b")).toBe(true);
});
it("quantizes camera zoom instead of changing on every small distance change", () => {
  expect(pinZoomStep(360, 776, 45)).toBe(1);
  expect(pinZoomStep(361, 776, 45)).toBe(1);
  expect(pinZoomStep(20, 776, 45)).toBe(5.5);
});
it("tap lookup finds nearest projected pin across a cell boundary and rejects empty space", () => {
  const lookup = tapGrid([{ x: 47, y: 50, radius: 14, value: "a" }, { x: 60, y: 50, radius: 14, value: "b" }]);
  expect(lookup(49, 50)).toBe("a");
  expect(lookup(60, 50)).toBe("b");
  expect(lookup(100, 50)).toBeUndefined();
});
it("accepts a stationary single-pointer tap", () => {
  const g = new TapGesture(); g.down(1, 50, 50, 0); expect(g.up(1, 52, 51, 100, false)).toBe(true);
});
it("rejects a drag even after returning to its starting point", () => {
  const g = new TapGesture(); g.down(1, 50, 50, 0); g.move(80, 50); expect(g.up(1, 50, 50, 100, false)).toBe(false);
});
it("rejects both fingers of a pinch or rotation", () => {
  const g = new TapGesture(); g.down(1, 50, 50, 0); g.down(2, 80, 50, 10);
  expect(g.up(2, 80, 50, 100, false)).toBe(false); expect(g.up(1, 50, 50, 110, false)).toBe(false);
});
it("rejects camera motion during a tap", () => {
  const g = new TapGesture(); g.down(1, 50, 50, 0); expect(g.up(1, 50, 50, 100, true)).toBe(false);
});
it("rejects wheel gestures, cancelled pointers, long presses and secondary buttons", () => {
  const g = new TapGesture(); g.wheel(0); g.down(1, 0, 0, 100); expect(g.up(1, 0, 0, 150, false)).toBe(false);
  g.down(1, 0, 0, 400); g.cancel(); expect(g.up(1, 0, 0, 450, false)).toBe(false);
  g.down(1, 0, 0, 500); expect(g.up(1, 0, 0, 1100, false)).toBe(false);
  g.down(1, 0, 0, 1200, false); expect(g.up(1, 0, 0, 1250, false)).toBe(false);
});