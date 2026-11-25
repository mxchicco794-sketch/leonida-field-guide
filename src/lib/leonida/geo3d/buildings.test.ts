import { describe, expect, it } from "vitest";
import { BB, FAR_MIN_HEIGHT, HEIGHT, TOWER_DENSITY, buildBuildings, classify, extrude, heightFor } from "./buildings";
import { CX, CY, LAND_H, type Pt, type Stats } from "./process";

const st = (): Stats => ({ rejectedPoints: 0, rejectedRings: 0, rejectedLines: 0, polygons: 0, lines: 0 });
const sq = (x: number, y: number, s: number): Pt[] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];

describe("stylized height rule", () => {
  it("classifies by footprint area and density", () => {
    expect(classify(5, 0)).toBe("large-lowrise");
    expect(classify(0.1, 200)).toBe("small");
    expect(classify(1, TOWER_DENSITY)).toBe("tower");
    expect(classify(1, TOWER_DENSITY - 1)).toBe("midrise");
  });
  it("heights stay within each documented band", () => {
    for (const c of ["small", "midrise", "large-lowrise", "tower"] as const) for (const h of [0, 0.5, 1]) {
      const v = heightFor(c, 500, h);
      expect(v).toBeGreaterThanOrEqual(HEIGHT[c][0]); expect(v).toBeLessThanOrEqual(HEIGHT[c][1]);
    }
  });
});

describe("extrusion", () => {
  it("roof sits on the exact footprint, walls reach land level", () => {
    const b = new BB(); const r = sq(300, 300, 1).slice(0, 4);
    expect(extrude(b, r, LAND_H, LAND_H + 1, [1, 1, 1], [1, 1, 1])).toBe(true);
    const m = b.done();
    expect([m.position[0], m.position[2]]).toEqual([300 - CX, 300 - CY]);
    expect(m.position[1]).toBeCloseTo(LAND_H + 1);
    expect(m.index.length / 3).toBe(2 + 4 * 2);
    expect(m.color.length).toBe(m.position.length);
    expect(Math.min(...Array.from(m.position).filter((_, i) => i % 3 === 1))).toBeCloseTo(LAND_H);
  });
});

describe("buildBuildings", () => {
  it("renders valid footprints, rejects invalid, deterministic", () => {
    const raw = [sq(300, 300, 1), [[300, 300], [301, 300]], "junk", sq(400, 400, 0.2)];
    const a = buildBuildings(raw, st()), b = buildBuildings(raw, st());
    expect(a.stats.rendered).toBe(2); expect(a.stats.rejected).toBe(2);
    expect(a.chunks.length).toBe(2); // different chunks
    expect(a.chunks[0]!.position).toEqual(b.chunks[0]!.position);
  });
  it("dense cluster yields towers that appear in the far LOD", () => {
    const raw: Pt[][] = [];
    for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) raw.push(sq(500 + i * 1.5, 500 + j * 1.5, 0.8));
    const r = buildBuildings(raw, st());
    expect(r.stats.byClass.tower).toBe(49);
    expect(r.stats.maxHeight).toBeGreaterThanOrEqual(FAR_MIN_HEIGHT);
    expect(r.far.index.length).toBeGreaterThan(0);
  });
});
