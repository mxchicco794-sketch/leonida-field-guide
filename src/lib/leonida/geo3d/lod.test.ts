import { describe, expect, it } from "vitest";
import { FAR_KINDS, LOD, junctions, processGeometry, simplify, type Pt } from "./process";

const wiggle: Pt[] = Array.from({ length: 41 }, (_, i) => [300 + i, 300 + (i % 2) * 0.1] as Pt);

describe("road simplification by zoom level", () => {
  it("near LOD removes sub-tolerance wiggle; far removes more", () => {
    const near = simplify(wiggle, LOD.near, new Set());
    const far = simplify(wiggle, LOD.far, new Set());
    expect(near.length).toBe(2);
    expect(far.length).toBeLessThanOrEqual(near.length);
    expect(near[0]).toEqual(wiggle[0]); expect(near[near.length - 1]).toEqual(wiggle[40]);
  });
  it("keeps corners larger than the tolerance", () => {
    const L: Pt[] = [[300, 300], [310, 300], [310, 310]];
    expect(simplify(L, LOD.far, new Set())).toEqual(L);
  });
  it("never drops a junction vertex shared with another road", () => {
    const a = wiggle, b: Pt[] = [[320, 300], [320, 340]]; // touches a at i=20
    const lock = junctions([a, b]);
    expect(lock.has("320,300")).toBe(true);
    for (const tol of [LOD.near, LOD.far]) expect(simplify(a, tol, lock)).toContainEqual([320, 300]);
  });
  it("far LOD only has arterial kinds and far fewer triangles", () => {
    const line = (k: string, y: number) => ({ properties: { kind: k }, geometry: { type: "LineString", coordinates: wiggle.map(([x]) => [x, y + (x % 2) * 0.1]) } });
    const p = processGeometry({
      land: [[[[300, 300], [400, 300], [400, 400], [300, 400]]]],
      surface: { features: [] }, rails: { features: [] },
      roads: { features: [line("highway", 310), line("street", 320)] },
    });
    expect(Object.keys(p.roadsFar)).toEqual(["highway"]);
    expect(FAR_KINDS).toEqual(["highway", "main"]);
    expect(p.roads["highway"]!.index.length / 3).toBe(2);
  });
});
