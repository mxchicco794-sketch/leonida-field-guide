import { expect, it, vi } from "vitest";
import { BufferAttribute, BufferGeometry, Mesh, Scene, type WebGLRenderer } from "three";
import { frameSummary, installBufferProbe, markNearGeometry, sceneCpuBytes } from "./region-metrics";

it("accounts actual allocated near GL buffers and releases deleted buffers", () => {
  const geometry = new BufferGeometry();
  const position = new Float32Array([1, 2, 3]); geometry.setAttribute("position", new BufferAttribute(position, 3)); markNearGeometry(geometry);
  const context = { bindBuffer: vi.fn(), bufferData: vi.fn(), deleteBuffer: vi.fn() };
  const probe = installBufferProbe({ getContext: () => context } as unknown as WebGLRenderer);
  const buffer = {};
  context.bindBuffer(1, buffer); context.bufferData(1, position, 2);
  expect(probe.bytes()).toBe(12); expect(probe.nearBytes()).toBe(12);
  context.bufferData(1, new Float32Array(6), 2);
  expect(probe.bytes()).toBe(24); expect(probe.nearBytes()).toBe(0);
  context.deleteBuffer(buffer); expect(probe.bytes()).toBe(0); expect(probe.count()).toBe(0);
  probe.dispose(); geometry.dispose();
});
it("counts shared CPU ArrayBuffers once and produces concrete frame quantiles", () => {
  const geometry = new BufferGeometry(); geometry.setAttribute("position", new BufferAttribute(new Float32Array([1, 2, 3]), 3));
  const scene = new Scene(); const a = new Mesh(geometry), b = new Mesh(geometry); a.userData["nearDetail"] = b.userData["nearDetail"] = true; scene.add(a, b);
  expect(sceneCpuBytes(scene, true)).toBe(12);
  expect(frameSummary(Array.from({ length: 100 }, (_, i) => i + 1))).toEqual({ samples: 100, median: 51, p95: 96, p99: 100 });
  geometry.dispose();
});