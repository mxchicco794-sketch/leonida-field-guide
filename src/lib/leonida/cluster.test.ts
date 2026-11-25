import { describe, expect, it } from "vitest";
import { clusterPoints, fold, inRings } from "./cluster";

const pts = [{ id: "a", x: 100, y: 100 }, { id: "b", x: 100.5, y: 100.5 }, { id: "c", x: 600, y: 600 }];

describe("clusterPoints", () => {
  it("groups nearby points when zoomed out and keeps every location", () => {
    const out = clusterPoints(pts, 0);
    const total = out.reduce((n, c) => n + (c.type === "single" ? 1 : c.items.length), 0);
    expect(total).toBe(3);
    expect(out.find((c) => c.type === "cluster")?.type === "cluster" && (out.find((c) => c.type === "cluster") as { items: unknown[] }).items.length).toBe(2);
  });
  it("separates all points at zoom 5 and above", () => {
    expect(clusterPoints(pts, 5).every((c) => c.type === "single")).toBe(true);
  });
});

it("inRings detects a point inside a square", () => {
  const sq: [number, number][][] = [[[0, 0], [10, 0], [10, 10], [0, 10]]];
  expect(inRings(5, 5, sq)).toBe(true);
  expect(inRings(15, 5, sq)).toBe(false);
});

it("fold ignores case and accents", () => {
  expect(fold("Città VICE")).toBe("citta vice");
});
