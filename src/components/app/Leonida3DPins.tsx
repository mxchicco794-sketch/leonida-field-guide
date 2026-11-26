import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Cluster } from "@/lib/leonida/cluster";
import type { Kind, LeonidaLocation } from "@/lib/leonida/types";
import { clusterPins, CLUSTER_SIZE, PIN_SIZE, pinPosition, pinZoomStep, tapGrid, TapGesture, type ScreenPin } from "@/lib/leonida/geo3d/pins";

export interface PinProps {
  locations: LeonidaLocation[]; kindMap: Map<string, Kind>; found: readonly string[];
  focusId?: string | undefined; onSelect: (loc: LeonidaLocation) => void;
}
type Pin = Cluster<LeonidaLocation>;
type Controls = { target: THREE.Vector3; update: () => void };
const vertexShader = `
  attribute vec3 pinColor;
  attribute float pinOpacity;
  attribute vec2 labelOffset;
  varying vec3 vColor;
  varying float vOpacity;
  varying vec2 vLabel;
  uniform float pointSize;
  void main() {
    vColor = pinColor; vOpacity = pinOpacity; vLabel = labelOffset;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p;
    gl_PointSize = p.w > 0.0 ? pointSize : 0.0;
  }
`;
const fragmentShader = `
  varying vec3 vColor;
  varying float vOpacity;
  varying vec2 vLabel;
  uniform vec3 rimColor;
  uniform vec3 labelColor;
  uniform sampler2D labels;
  uniform float labelled;
  uniform float atlasScale;
  void main() {
    float r = length(gl_PointCoord - vec2(0.5));
    if (r > 0.5) discard;
    vec3 c = r > 0.41 ? rimColor : vColor;
    if (labelled > 0.5) {
      vec2 uv = vLabel + vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y) * atlasScale;
      c = mix(c, labelColor, texture2D(labels, uv).a);
    }
    gl_FragColor = vec4(c, vOpacity);
    #include <colorspace_fragment>
  }
`;

/** Convert CSS semantic tokens through Canvas, which supports the app's oklch palette. */
function tokenColor(name: string) {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return new THREE.Color();
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  ctx.fillRect(0, 0, 1, 1);
  const p = ctx.getImageData(0, 0, 1, 1).data;
  return new THREE.Color().setRGB((p[0] ?? 0) / 255, (p[1] ?? 0) / 255, (p[2] ?? 0) / 255, THREE.SRGBColorSpace);
}

function batch(labelled: boolean) {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.ShaderMaterial({
    vertexShader, fragmentShader, transparent: true, depthTest: false, depthWrite: false,
    fog: false, toneMapped: false,
    uniforms: {
      pointSize: { value: labelled ? CLUSTER_SIZE : PIN_SIZE },
      rimColor: { value: new THREE.Color() }, labelColor: { value: new THREE.Color() },
      labels: { value: null }, labelled: { value: labelled ? 1 : 0 }, atlasScale: { value: 1 },
    },
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; points.renderOrder = labelled ? 101 : 102;
  points.visible = false;
  return points;
}

export default function Leonida3DPins(props: PinProps) {
  const { camera, gl, size, controls, scene } = useThree();
  const current = useRef(props); current.current = props;
  const batches = useMemo(() => ({ singles: batch(false), clusters: batch(true) }), []);
  const state = useRef({ zoom: NaN, pins: [] as Pin[], previous: null as PinProps | null, focused: "", rebuilds: 0 });
  const vector = useMemo(() => new THREE.Vector3(), []);
  const atlas = useRef<THREE.CanvasTexture | null>(null);
  const control = controls as unknown as Controls | null;

  function moveTo(x: number, y: number, distance: number) {
    if (!control) return;
    const target = new THREE.Vector3(...pinPosition({ x, y }));
    const offset = camera.position.clone().sub(control.target).normalize().multiplyScalar(distance);
    control.target.copy(target); camera.position.copy(target).add(offset); control.update();
  }

  function project(): ScreenPin<Pin>[] {
    camera.updateMatrixWorld();
    const out: ScreenPin<Pin>[] = [];
    for (const pin of state.current.pins) {
      const loc = pin.type === "single" ? pin.item : pin;
      vector.set(...pinPosition(loc)).project(camera);
      if (vector.z < -1 || vector.z > 1 || Math.abs(vector.x) > 1 || Math.abs(vector.y) > 1) continue;
      out.push({ x: (vector.x + 1) * size.width / 2, y: (1 - vector.y) * size.height / 2,
        radius: pin.type === "single" ? 13 : CLUSTER_SIZE / 2, value: pin });
    }
    return out;
  }

  useFrame(() => {
    const p = current.current;
    const distance = control ? camera.position.distanceTo(control.target) : camera.position.length();
    const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 45;
    const zoom = pinZoomStep(distance, size.height, fov);
    const old = state.current.previous;
    if (zoom !== state.current.zoom || !old || old.locations !== p.locations || old.kindMap !== p.kindMap || old.found !== p.found || old.focusId !== p.focusId) {
      state.current.zoom = zoom; state.current.previous = p; state.current.rebuilds++;
      const pins = clusterPins(p.locations, zoom, p.focusId);
      state.current.pins = pins;
      const found = new Set(p.found);
      const primary = tokenColor("--primary"), rim = tokenColor("--background"), text = tokenColor("--primary-foreground");
      const clusterList = pins.filter((pin) => pin.type === "cluster");
      const side = Math.max(1, Math.ceil(Math.sqrt(clusterList.length)));
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = side * 64;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--primary-foreground").trim();
        ctx.font = "bold 22px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        clusterList.forEach((pin, i) => ctx.fillText(String(pin.items.length), (i % side) * 64 + 32, Math.floor(i / side) * 64 + 32, 46));
      }
      atlas.current?.dispose(); atlas.current = new THREE.CanvasTexture(canvas);
      let clusterIndex = 0;
      for (const [isCluster, points] of [[false, batches.singles], [true, batches.clusters]] as const) {
        const list = pins.filter((pin) => (pin.type === "cluster") === isCluster);
        const positions: number[] = [], colors: number[] = [], opacity: number[] = [], offsets: number[] = [];
        for (const pin of list) {
          positions.push(...pinPosition(pin.type === "single" ? pin.item : pin));
          const color = pin.type === "single" ? new THREE.Color(p.kindMap.get(pin.item.kind)?.colour ?? primary) : primary;
          colors.push(color.r, color.g, color.b);
          opacity.push(pin.type === "single" && found.has(pin.item.id) ? 0.62 : 1);
          if (isCluster) {
            offsets.push((clusterIndex % side) / side, 1 - (Math.floor(clusterIndex / side) + 1) / side); clusterIndex++;
          } else offsets.push(0, 0);
        }
        // Release only pin buffers, never the existing map geometry/materials.
        points.geometry.dispose();
        points.geometry = new THREE.BufferGeometry();
        points.geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        points.geometry.setAttribute("pinColor", new THREE.Float32BufferAttribute(colors, 3));
        points.geometry.setAttribute("pinOpacity", new THREE.Float32BufferAttribute(opacity, 1));
        points.geometry.setAttribute("labelOffset", new THREE.Float32BufferAttribute(offsets, 2));
        points.geometry.setDrawRange(0, list.length); points.visible = list.length > 0;
        const u = points.material.uniforms;
        if (u["rimColor"]) u["rimColor"].value = rim;
        if (u["labelColor"]) u["labelColor"].value = text;
        if (u["labels"]) u["labels"].value = atlas.current;
        if (u["atlasScale"]) u["atlasScale"].value = 1 / side;
      }
    }
    for (const points of [batches.singles, batches.clusters]) {
      const u = points.material.uniforms["pointSize"];
      if (u) u.value = (points === batches.singles ? PIN_SIZE : CLUSTER_SIZE) * gl.getPixelRatio();
    }
    if (p.focusId && state.current.focused !== p.focusId) {
      const loc = p.locations.find((l) => l.id === p.focusId);
      if (loc && control) { state.current.focused = p.focusId; moveTo(loc.x, loc.y, 65); }
    }
  });

  useEffect(() => {
    const canvas = gl.domElement, gesture = new TapGesture();
    const startMatrix = new THREE.Matrix4();
    const down = (e: PointerEvent) => {
      camera.updateMatrixWorld(); startMatrix.copy(camera.matrixWorld);
      gesture.down(e.pointerId, e.clientX, e.clientY, e.timeStamp, e.button === 0);
    };
    const move = (e: PointerEvent) => gesture.move(e.clientX, e.clientY);
    const up = (e: PointerEvent) => {
      camera.updateMatrixWorld();
      const changed = startMatrix.elements.some((n, i) => Math.abs(n - (camera.matrixWorld.elements[i] ?? n)) > 0.00001);
      if (!gesture.up(e.pointerId, e.clientX, e.clientY, e.timeStamp, changed)) return;
      const rect = canvas.getBoundingClientRect();
      const pin = tapGrid(project())(e.clientX - rect.left, e.clientY - rect.top);
      if (!pin) return;
      if (pin.type === "single") current.current.onSelect(pin.item);
      else {
        const d = control ? camera.position.distanceTo(control.target) : 100;
        moveTo(pin.x, pin.y, Math.max(20, d * 0.45));
      }
    };
    const cancel = () => gesture.cancel();
    const wheel = (e: WheelEvent) => gesture.wheel(e.timeStamp);
    canvas.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("blur", cancel);
    canvas.addEventListener("wheel", wheel, { passive: true, capture: true });
    if (import.meta.env.DEV) {
      const debug = window as unknown as { __pins3d?: unknown };
      debug.__pins3d = {
        snapshot: () => ({ zoom: state.current.zoom, rebuilds: state.current.rebuilds,
          locations: current.current.locations.length,
          singles: state.current.pins.filter((p) => p.type === "single").length,
          clusters: state.current.pins.filter((p) => p.type === "cluster").length,
          projected: project().map((p) => ({ x: p.x, y: p.y, id: p.value.type === "single" ? p.value.item.id : null, count: p.value.type === "cluster" ? p.value.items.length : 1 })),
          render: { ...gl.info.render }, memory: { ...gl.info.memory } }),
        measure: () => {
          const a = batches.singles.visible, b = batches.clusters.visible;
          batches.singles.visible = batches.clusters.visible = false;
          gl.render(scene, camera); const before = { ...gl.info.render };
          batches.singles.visible = a; batches.clusters.visible = b;
          gl.render(scene, camera); const after = { ...gl.info.render };
          return { before, after };
        },
      };
    }
    return () => {
      canvas.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("blur", cancel);
      canvas.removeEventListener("wheel", wheel, true);
      if (import.meta.env.DEV) delete (window as unknown as { __pins3d?: unknown }).__pins3d;
    };
  }, [camera, gl, size.width, size.height, control, scene]);

  useEffect(() => () => {
    atlas.current?.dispose();
    for (const points of [batches.singles, batches.clusters]) { points.geometry.dispose(); points.material.dispose(); }
  }, [batches]);

  return <group dispose={null}><primitive object={batches.clusters} /><primitive object={batches.singles} /></group>;
}