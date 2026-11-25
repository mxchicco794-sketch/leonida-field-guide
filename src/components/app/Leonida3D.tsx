import { Canvas } from "@react-three/fiber";
import { MapControls } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import type { District, GeoFeature, Geometry } from "@/lib/leonida/types";

/** Map units (x right, y down) centred on the source map extent; y becomes world Z. */
const CX = 496, CY = 480;
const LAND_H = 1.2;
const ROAD: Record<string, { c: string; h: number }> = {
  highway: { c: "#f4d58d", h: 0.06 }, main: { c: "#e8c27a", h: 0.05 }, minor: { c: "#a89a80", h: 0.04 }, street: { c: "#6f6a62", h: 0.03 },
};

function lines(features: GeoFeature[]): [number, number][][] {
  const out: [number, number][][] = [];
  for (const f of features) {
    const c = f.geometry.coordinates;
    if (f.geometry.type === "LineString") out.push(c as [number, number][]);
    else if (f.geometry.type === "MultiLineString") out.push(...(c as [number, number][][]));
  }
  return out;
}

function segGeo(paths: [number, number][][], lift: number) {
  const pos: number[] = [];
  for (const p of paths) for (let i = 1; i < p.length; i++) {
    const a = p[i - 1]!, b = p[i]!;
    pos.push(a[0] - CX, LAND_H + lift, a[1] - CY, b[0] - CX, LAND_H + lift, b[1] - CY);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

function Land({ land }: { land: Geometry["land"] }) {
  const geo = useMemo(() => {
    const shapes: THREE.Shape[] = [];
    for (const poly of land) {
      const [outer, ...holes] = poly;
      if (!outer || outer.length < 3) continue;
      const s = new THREE.Shape(outer.map(([x, y]) => new THREE.Vector2(x - CX, -(y - CY))));
      for (const h of holes) if (h.length >= 3) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x - CX, -(y - CY)))));
      shapes.push(s);
    }
    const g = new THREE.ExtrudeGeometry(shapes, { depth: LAND_H, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    return g;
  }, [land]);
  return <mesh geometry={geo}><meshStandardMaterial color="#2a2724" roughness={0.9} /></mesh>;
}

export default function Leonida3D({ geometry, districts }: { geometry: Geometry; districts: District[] }) {
  const roads = useMemo(() => {
    const by: Record<string, GeoFeature[]> = {};
    for (const f of geometry.roads.features) (by[f.properties["kind"] ?? "street"] ??= []).push(f);
    return Object.entries(by).map(([k, fs]) => ({ k, geo: segGeo(lines(fs), ROAD[k]?.h ?? 0.03), c: ROAD[k]?.c ?? "#6f6a62" }));
  }, [geometry]);
  const rails = useMemo(() => segGeo(lines(geometry.rails.features), 0.07), [geometry]);
  const dist = useMemo(() => segGeo(districts.flatMap((d) => d.rings.map((r) => [...r, r[0]!])), 0.1), [districts]);

  return (
    <div className="h-full w-full" data-scene-ready>
      <Canvas camera={{ position: [0, 260, 260], fov: 45, near: 1, far: 3000 }} dpr={[1, 2]}>
        <color attach="background" args={["#0b1418"]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[200, 400, 150]} intensity={1.4} />
        <mesh rotation-x={-Math.PI / 2} position-y={-0.05}><planeGeometry args={[1400, 1400]} /><meshStandardMaterial color="#10232b" /></mesh>
        <Land land={geometry.land} />
        {roads.map((r) => <lineSegments key={r.k} geometry={r.geo}><lineBasicMaterial color={r.c} /></lineSegments>)}
        <lineSegments geometry={rails}><lineBasicMaterial color="#c0c0c0" /></lineSegments>
        <lineSegments geometry={dist}><lineBasicMaterial color="#e5383b" transparent opacity={0.6} /></lineSegments>
        <MapControls makeDefault enableDamping maxPolarAngle={1.3} minDistance={20} maxDistance={900} />
      </Canvas>
    </div>
  );
}
