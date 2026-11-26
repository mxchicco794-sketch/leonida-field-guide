import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { RegionStream } from "@/lib/leonida/geo3d/region-stream";
import { regionalCache, type StagedRegional } from "@/lib/leonida/geo3d/regional-cache";
import { FAR_DISTANCE, type Mesh } from "@/lib/leonida/geo3d/process";
import type { BMesh } from "@/lib/leonida/geo3d/buildings";
import { pinZoomStep } from "@/lib/leonida/geo3d/pins";
import { sceneCpuBytes, frameSummary } from "@/lib/leonida/geo3d/region-metrics";

interface Props {
  prepared: StagedRegional;
  near: React.RefObject<THREE.Group | null>; far: React.RefObject<THREE.Group | null>;
  material: THREE.Material; roads: Record<string, THREE.Material>;
  makeGeometry: (mesh: Mesh | BMesh, normals?: boolean) => THREE.BufferGeometry;
  onError: (message: string) => void;
}
export default function Leonida3DRegions({ prepared, near, far, material, roads, makeGeometry, onError }: Props) {
  const group = useMemo(() => new THREE.Group(), []);
  const boxes = useMemo(() => prepared.manifest.regions.map((meta) => ({ meta, box: new THREE.Box3(new THREE.Vector3(...meta.bounds.min), new THREE.Vector3(...meta.bounds.max)) })), [prepared]);
  const stream = useMemo(() => new RegionStream<THREE.Mesh>({ manifest: prepared.manifest,
    read: (id, signal) => regionalCache.read(prepared, id, signal),
    install: (payload, meta) => {
      const geometry = makeGeometry(payload.mesh, meta.kind === "building");
      const shared = meta.kind === "building" ? material : roads[meta.roadKind ?? "street"];
      if (!shared) { geometry.dispose(); throw new Error("Materiale della strada non supportato"); }
      const mesh = new THREE.Mesh(geometry, shared); mesh.visible = false; mesh.userData["nearDetail"] = true;
      if (meta.kind === "road") mesh.renderOrder = 10 + ["street", "minor", "main", "highway"].indexOf(meta.roadKind ?? "street");
      group.add(mesh);
      return { resource: mesh, bytes: meta.bytes + (meta.kind === "building" ? payload.mesh.position.byteLength : 0) };
    },
    dispose: (mesh) => { group.remove(mesh); mesh.geometry.dispose(); },
  }), [prepared, group, material, roads, makeGeometry]);
  const frustum = useMemo(() => new THREE.Frustum(), []), matrix = useMemo(() => new THREE.Matrix4(), []), expanded = useMemo(() => new THREE.Box3(), []);
  const clock = useRef({ zoom: NaN, error: false, last: 0, frames: [] as number[], readinessChanges: 0, ready: false });
  useFrame(({ camera, controls, scene, size }) => {
    const now = performance.now(), state = clock.current;
    if (state.last && !document.hidden) { state.frames.push(now - state.last); if (state.frames.length > 600) state.frames.shift(); }
    state.last = now;
    const target = (controls as unknown as { target?: THREE.Vector3 } | null)?.target ?? new THREE.Vector3();
    const distance = camera.position.distanceTo(target), isNear = distance <= FAR_DISTANCE;
    camera.updateMatrixWorld(); frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const required: string[] = [], prefetch: { id: string; distance: number }[] = [];
    if (isNear) for (const { meta, box } of boxes) {
      const center = meta.bounds.center;
      if (meta.kind === "building" && Math.hypot(center[0] - target.x, center[2] - target.z) >= 190) continue;
      if (frustum.intersectsBox(box)) required.push(meta.id);
      else if (frustum.intersectsBox(expanded.copy(box).expandByScalar(20))) prefetch.push({ id: meta.id, distance: Math.hypot(center[0] - target.x, center[2] - target.z) });
    }
    prefetch.sort((a, b) => a.distance - b.distance);
    stream.demand(required, prefetch.map((p) => p.id), now);
    const zoom = pinZoomStep(distance, size.height, camera instanceof THREE.PerspectiveCamera ? camera.fov : 45);
    stream.frame(now, zoom === state.zoom); state.zoom = zoom;
    const ready = isNear && stream.ready;
    if (ready !== state.ready) { state.readinessChanges++; state.ready = ready; }
    if (near.current) near.current.visible = ready;
    if (far.current) far.current.visible = !ready;
    for (const [id, resident] of stream.residents) resident.resource.visible = stream.isRequired(id);
    if (stream.error && !state.error) { state.error = true; onError(stream.error.message); }
    if (import.meta.env.DEV) {
      (window as unknown as { __regions3d?: unknown }).__regions3d = {
        snapshot: () => ({ ...stream.snapshot(), generation: prepared.manifest.generation, via: prepared.via, mode: "regional", legacyNearBytes: prepared.manifest.legacyNearBytes, nearGeometryBytes: sceneCpuBytes(scene, true), readinessChanges: state.readinessChanges, frameMs: frameSummary(state.frames) }),
      };
    }
  });
  useEffect(() => () => { stream.dispose(); if (import.meta.env.DEV) delete (window as unknown as { __regions3d?: unknown }).__regions3d; }, [stream]);
  return <group dispose={null}><primitive object={group} /></group>;
}