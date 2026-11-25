import { Canvas } from "@react-three/fiber";
import { MapControls } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { District } from "@/lib/leonida/types";
import { CX, CY, LAND_H, type Mesh, type Processed } from "@/lib/leonida/geo3d/process";

const ROAD_COLOR: Record<string, string> = { highway: "#f4d58d", main: "#e8c27a", minor: "#a89a80", street: "#6f6a62" };
const ORDER = ["street", "minor", "main", "highway"];

function meshGeo(m: Mesh) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(m.position, 3));
  g.setIndex(new THREE.BufferAttribute(m.index, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Dispose GPU buffers when the geometry set changes or the view unmounts. */
function useDisposable<T extends { dispose(): void }>(items: T[]) {
  useEffect(() => () => items.forEach((i) => i.dispose()), [items]);
}

export default function Leonida3D({ data, districts }: { data: Processed; districts: District[] }) {
  const land = useMemo(() => meshGeo(data.land), [data]);
  const roads = useMemo(() => Object.entries(data.roads)
    .sort(([a], [b]) => ORDER.indexOf(a) - ORDER.indexOf(b))
    .map(([k, m], i) => ({ k, geo: meshGeo(m), c: ROAD_COLOR[k] ?? "#6f6a62", i })), [data]);
  const rails = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(data.rails, 3));
    return g;
  }, [data]);
  const dist = useMemo(() => {
    const pos: number[] = [];
    for (const d of districts) for (const r of d.rings) for (let i = 0; i < r.length; i++) {
      const a = r[i]!, b = r[(i + 1) % r.length]!;
      pos.push(a[0] - CX, LAND_H + 0.12, a[1] - CY, b[0] - CX, LAND_H + 0.12, b[1] - CY);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return g;
  }, [districts]);
  useDisposable(useMemo(() => [land, rails, ...roads.map((r) => r.geo)], [land, rails, roads]));
  useDisposable(useMemo(() => [dist], [dist]));

  return (
    <div className="h-full w-full" data-scene-ready>
      <Canvas camera={{ position: [0, 260, 260], fov: 45, near: 1, far: 3000 }} dpr={[1, 2]}>
        <color attach="background" args={["#0b1418"]} />
        <ambientLight intensity={0.6} />
        <directionalLight position={[200, 400, 150]} intensity={1.4} />
        <mesh rotation-x={-Math.PI / 2} position-y={-0.05}><planeGeometry args={[1400, 1400]} /><meshStandardMaterial color="#10232b" /></mesh>
        <mesh geometry={land}><meshStandardMaterial color="#2a2724" roughness={0.9} side={THREE.DoubleSide} /></mesh>
        {roads.map((r) => (
          <mesh key={r.k} geometry={r.geo} renderOrder={1 + r.i}>
            <meshBasicMaterial color={r.c} polygonOffset polygonOffsetFactor={-1 - r.i} polygonOffsetUnits={-1 - r.i} />
          </mesh>
        ))}
        <lineSegments geometry={rails}><lineBasicMaterial color="#c0c0c0" /></lineSegments>
        <lineSegments geometry={dist}><lineBasicMaterial color="#e5383b" transparent opacity={0.6} /></lineSegments>
        <MapControls makeDefault enableDamping maxPolarAngle={1.3} minDistance={20} maxDistance={900} />
      </Canvas>
    </div>
  );
}
