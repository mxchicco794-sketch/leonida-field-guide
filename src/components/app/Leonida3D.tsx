import { Canvas, useFrame } from "@react-three/fiber";
import { MapControls } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { District } from "@/lib/leonida/types";
import { CX, CY, FAR_DISTANCE, LAND_H, type Mesh, type Processed } from "@/lib/leonida/geo3d/process";

/** Palette (dark identity). Module-level so materials are created once and reused across mounts. */
const ROAD_COLOR: Record<string, string> = { highway: "#e9c77f", main: "#cfae72", minor: "#7d7466", street: "#5b5650" };
const SURF_COLOR: Record<string, string> = { shallow: "#16404a", sand: "#6e6248", park: "#2c4a31", urban: "#34312e", paved: "#3c3a37" };
/** Draw order bottom→top; "building" footprints are intentionally not drawn in this phase. */
const SURF_ORDER = ["shallow", "sand", "park", "urban", "paved"];
const ROAD_ORDER = ["street", "minor", "main", "highway"];
const mat = (c: string, i: number) => new THREE.MeshBasicMaterial({ color: c, polygonOffset: true, polygonOffsetFactor: -1 - i, polygonOffsetUnits: -1 - i, depthWrite: false });
const M = {
  ocean: new THREE.MeshBasicMaterial({ color: "#0a1c24" }),
  land: new THREE.MeshLambertMaterial({ color: "#26231f", side: THREE.DoubleSide }),
  surf: Object.fromEntries(SURF_ORDER.map((k, i) => [k, mat(SURF_COLOR[k]!, i)])),
  road: Object.fromEntries(ROAD_ORDER.map((k, i) => [k, mat(ROAD_COLOR[k]!, 6 + i)])),
  rail: new THREE.LineBasicMaterial({ color: "#a9a9a9" }),
  dist: new THREE.LineBasicMaterial({ color: "#e5383b", transparent: true, opacity: 0.55 }),
};
const OCEAN = new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2);

function meshGeo(m: Mesh, normals = false) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.position, 3));
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  if (normals) g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
const ordered = (r: Record<string, Mesh>, order: string[]) =>
  order.filter((k) => r[k]?.index.length).map((k, i) => ({ k, geo: meshGeo(r[k]!), i }));

/** Switches road LOD by camera distance in useFrame — toggles visibility only, no React state, no rebuilds. */
function LodSwitch({ near, far }: { near: React.RefObject<THREE.Group | null>; far: React.RefObject<THREE.Group | null> }) {
  useFrame(({ camera, controls }) => {
    const t = (controls as unknown as { target?: THREE.Vector3 } | null)?.target;
    const d = t ? camera.position.distanceTo(t) : camera.position.length();
    const isFar = d > FAR_DISTANCE;
    if (near.current && near.current.visible === isFar) near.current.visible = !isFar;
    if (far.current && far.current.visible !== isFar) far.current.visible = isFar;
  });
  return null;
}

export default function Leonida3D({ data, districts }: { data: Processed; districts: District[] }) {
  // Built once per processed dataset; GPU buffers freed on change/unmount.
  const g = useMemo(() => {
    const rails = new THREE.BufferGeometry();
    rails.setAttribute("position", new THREE.BufferAttribute(data.rails, 3));
    return {
      land: meshGeo(data.land, true),
      surf: ordered(data.surface, SURF_ORDER),
      near: ordered(data.roads, ROAD_ORDER),
      far: ordered(data.roadsFar ?? {}, ROAD_ORDER),
      rails,
    };
  }, [data]);
  const dist = useMemo(() => {
    const pos: number[] = [];
    for (const d of districts) for (const r of d.rings) for (let i = 0; i < r.length; i++) {
      const a = r[i]!, b = r[(i + 1) % r.length]!;
      pos.push(a[0] - CX, LAND_H + 0.15, a[1] - CY, b[0] - CX, LAND_H + 0.15, b[1] - CY);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return geo;
  }, [districts]);
  useEffect(() => () => { [g.land, g.rails, ...g.surf, ...g.near, ...g.far].forEach((x) => ("geo" in x ? x.geo : x).dispose()); }, [g]);
  useEffect(() => () => dist.dispose(), [dist]);
  const nearRef = useRef<THREE.Group>(null), farRef = useRef<THREE.Group>(null);

  return (
    <div className="h-full w-full" data-scene-ready>
      <Canvas camera={{ position: [0, 260, 260], fov: 45, near: 1, far: 3000 }} dpr={[1, 2]} gl={{ powerPreference: "high-performance", antialias: true }} onCreated={(s) => { if (import.meta.env.DEV) (window as unknown as { __gl3d?: unknown }).__gl3d = s.gl; }}>
        <color attach="background" args={["#07131a"]} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[200, 400, 150]} intensity={1.2} />
        <mesh geometry={OCEAN} material={M.ocean} position-y={-0.05} />
        <mesh geometry={g.land} material={M.land} />
        {g.surf.map((s) => <mesh key={s.k} geometry={s.geo} material={M.surf[s.k]!} renderOrder={1 + s.i} />)}
        <group ref={nearRef}>{g.near.map((r) => <mesh key={r.k} geometry={r.geo} material={M.road[r.k]!} renderOrder={10 + ROAD_ORDER.indexOf(r.k)} />)}</group>
        <group ref={farRef} visible={false}>{g.far.map((r) => <mesh key={r.k} geometry={r.geo} material={M.road[r.k]!} renderOrder={10 + ROAD_ORDER.indexOf(r.k)} />)}</group>
        <lineSegments geometry={g.rails} material={M.rail} renderOrder={20} />
        <lineSegments geometry={dist} material={M.dist} renderOrder={21} />
        <LodSwitch near={nearRef} far={farRef} />
        <MapControls makeDefault enableDamping dampingFactor={0.12} maxPolarAngle={1.3} minDistance={20} maxDistance={900} />
      </Canvas>
    </div>
  );
}
