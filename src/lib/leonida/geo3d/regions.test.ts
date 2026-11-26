import { describe, expect, it } from "vitest";
import { BufferAttribute, BufferGeometry } from "three";
import { processGeometry, type Mesh } from "./process";
import { adaptRegions, assertPrepared, assertRegion, partitionRoad, roadCell } from "./regions";

const fixture = () => processGeometry({
  land: [[[[300, 300], [600, 300], [600, 700], [300, 700]]]],
  surface: { features: [{ properties: { layer: "building" }, geometry: { type: "Polygon", coordinates: [[[400, 400], [402, 400], [402, 402], [400, 402]]] } }] },
  roads: { features: [{ properties: { kind: "highway" }, geometry: { type: "LineString", coordinates: [[320, 400], [410, 400], [500, 420], [590, 420]] } }] }, rails: { features: [] },
});
function triangles(m: Mesh) {
  const out: string[] = [];
  for (let i = 0; i < m.index.length; i += 3) out.push([m.index[i], m.index[i + 1], m.index[i + 2]].flatMap((j) => {
    if (j === undefined) throw new Error("Missing index");
    return Array.from(m.position.slice(j * 3, j * 3 + 3));
  }).join(","));
  return out.sort();
}
describe("lossless regional adapter gate", () => {
  it("assigns outer bounds and shared grid edges consistently", () => {
    expect(roadCell(160 - 496, 160 - 480)).toBe("0,0");
    expect(roadCell(832 - 496, 800 - 480)).toBe("7,7");
    expect(roadCell(244 - 496, 240 - 480)).toBe("1,1");
  });
  it("preserves every road triangle and winding exactly once across regions", () => {
    const p = fixture(); const road = p.roads["highway"];
    if (!road) throw new Error("Missing road");
    const parts = partitionRoad(road, "highway");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.flatMap((r) => triangles(r.mesh)).sort()).toEqual(triangles(road));
  });
  it("preserves whole building output, normals and unchanged global buffers", () => {
    const p = fixture(), a = adaptRegions(p, 0);
    const building = a.payloads.find((r) => r.id.startsWith("b:"));
    expect(building?.mesh).toBe(p.buildings.chunks[0]);
    expect(a.global.land).toBe(p.land); expect(a.global.surface).toBe(p.surface);
    expect(a.global.roadsFar).toBe(p.roadsFar); expect(a.global.buildings.far).toBe(p.buildings.far);
    expect(a.global.rails).toBe(p.rails);
    const normal = (m: Mesh) => { const g = new BufferGeometry(); g.setAttribute("position", new BufferAttribute(m.position, 3)); g.setIndex(new BufferAttribute(m.index, 1)); g.computeVertexNormals(); const result = Array.from(g.getAttribute("normal").array); g.dispose(); return result; };
    if (!building || !p.buildings.chunks[0]) throw new Error("Missing building");
    expect(normal(building.mesh)).toEqual(normal(p.buildings.chunks[0]));
    assertPrepared(a);
    for (const meta of a.manifest.regions) {
      const payload = a.payloads.find((r) => r.id === meta.id);
      if (!payload) throw new Error("Missing payload"); assertRegion(payload, meta);
    }
  });
  it("uses reproducible content identities and detects changed output", () => {
    const a = adaptRegions(fixture(), 0), b = adaptRegions(fixture(), 5);
    expect(a.manifest.generation).toBe(b.manifest.generation);
    expect(a.manifest.regions.map((m) => m.id)).toEqual(b.manifest.regions.map((m) => m.id));
    const payload = a.payloads[0], meta = a.manifest.regions[0];
    if (!payload || !meta) throw new Error("Missing fixture");
    payload.mesh.position[0] = (payload.mesh.position[0] ?? 0) + 1;
    expect(() => assertRegion(payload, meta)).toThrow("integrity");
  });
});