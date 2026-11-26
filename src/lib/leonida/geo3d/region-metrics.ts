import type { WebGLRenderer, Scene, BufferGeometry } from "three";

const nearArrays = new WeakSet<ArrayBufferLike>();
export function markNearGeometry(geometry: BufferGeometry) {
  for (const attribute of [...Object.values(geometry.attributes), ...(geometry.index ? [geometry.index] : [])]) {
    if ("array" in attribute) nearArrays.add(attribute.array.buffer);
  }
}

/** Development-only accounting: actual submitted GL buffer bytes, not driver VRAM. */
export function installBufferProbe(renderer: WebGLRenderer) {
  const context = renderer.getContext();
  const gl = context as unknown as { bindBuffer: (...args: unknown[]) => unknown; bufferData: (...args: unknown[]) => unknown; deleteBuffer: (...args: unknown[]) => unknown };
  const bind = gl.bindBuffer, data = gl.bufferData, del = gl.deleteBuffer;
  const bindings = new Map<unknown, unknown>(), sizes = new Map<unknown, { bytes: number; near: boolean }>();
  gl.bindBuffer = function (...args) { bindings.set(args[0], args[1]); return Reflect.apply(bind, context, args); };
  gl.bufferData = function (...args) {
    const buffer = bindings.get(args[0]), value = args[1];
    if (buffer) sizes.set(buffer, { bytes: typeof value === "number" ? value : ArrayBuffer.isView(value) ? value.byteLength : value instanceof ArrayBuffer ? value.byteLength : 0, near: ArrayBuffer.isView(value) && nearArrays.has(value.buffer) });
    return Reflect.apply(data, context, args);
  };
  gl.deleteBuffer = function (...args) { sizes.delete(args[0]); return Reflect.apply(del, context, args); };
  return {
    bytes: () => [...sizes.values()].reduce((a, b) => a + b.bytes, 0),
    nearBytes: () => [...sizes.values()].reduce((a, b) => a + (b.near ? b.bytes : 0), 0),
    count: () => sizes.size,
    dispose: () => { gl.bindBuffer = bind; gl.bufferData = data; gl.deleteBuffer = del; sizes.clear(); bindings.clear(); },
  };
}

export function sceneCpuBytes(scene: Scene, nearOnly = false) {
  const buffers = new Set<ArrayBufferLike>(); let bytes = 0;
  scene.traverse((obj) => {
    const geometry = (obj as unknown as { geometry?: BufferGeometry }).geometry;
    if (!geometry || (nearOnly && !obj.userData["nearDetail"])) return;
    for (const attribute of [...Object.values(geometry.attributes), ...(geometry.index ? [geometry.index] : [])]) {
      if (!("array" in attribute)) continue;
      const array = attribute.array;
      if (!buffers.has(array.buffer)) { buffers.add(array.buffer); bytes += array.buffer.byteLength; }
    }
  });
  return bytes;
}

export function frameSummary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
  return { samples: sorted.length, median: q(0.5), p95: q(0.95), p99: q(0.99) };
}