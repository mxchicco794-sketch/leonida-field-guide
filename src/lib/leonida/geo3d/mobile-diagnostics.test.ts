import { describe, expect, it, vi } from "vitest";
import { comparisonReport, frameStats, readDiagnostics, RECORD_MS, STABLE_MS, startRecording, type DiagnosticMode, type DiagnosticResult } from "./mobile-diagnostics";

const metrics = () => ({ sceneCpuBytes: 1048576, nearCpuBytes: 512, gpuBufferBytes: 2048, gpuNearBufferBytes: 256, camera: [0, 260, 260], target: [0, 0, 0], render: { calls: 14, triangles: 145270 }, frameMs: { median: 16, p95: 22, p99: 40 } });
const region = () => ({ resident: 8, required: 8, pending: 0, prepared: 0, ready: true, cpuBytes: 4096, error: null });
function harness(mode: DiagnosticMode = "legacy") {
  let snapshot = readDiagnostics(mode, metrics, region), hidden = false, id = 0;
  const scheduled = new Map<number, (now: number) => void>();
  const complete = vi.fn<(result: DiagnosticResult) => void>(), error = vi.fn(), progress = vi.fn();
  const read = vi.fn(() => snapshot);
  const stop = startRecording({ mode, read, hidden: () => hidden,
    request: (cb) => { scheduled.set(++id, cb); return id; }, cancel: (n) => { scheduled.delete(n); },
    device: "Android", userAgent: "test", onProgress: progress, onComplete: complete, onError: error });
  const tick = (now: number) => { const item = [...scheduled.entries()][0]; if (!item) return; scheduled.delete(item[0]); item[1](now); };
  return { tick, stop, scheduled, complete, error, progress, read, set: (s: typeof snapshot) => { snapshot = s; }, hide: () => { hidden = true; } };
}
describe("preview mobile diagnostics", () => {
  it("reads concrete probe values and never estimates unavailable counters", () => {
    const s = readDiagnostics("regional", metrics, region);
    expect(s.cpu).toBe(1048576); expect(s.gpu).toBe(2048); expect(s.calls).toBe(14); expect(s.triangles).toBe(145270); expect(s.regionalCpu).toBe(4096);
    expect(readDiagnostics("legacy", metrics, region).resident).toBeNull();
    expect(readDiagnostics("legacy").gpu).toBeNull(); expect(s.mean).toBeNull();
    expect(readDiagnostics(null, () => ({ gpuBufferBytes: NaN, render: null })).calls).toBeNull();
  });
  it("captures probe exceptions and exposed regional errors", () => {
    expect(readDiagnostics("regional", () => { throw Error("probe"); }, () => ({ error: "read failed" }), "route").errors).toHaveLength(3);
  });
  it("computes actual mean and full-session quantiles", () => {
    expect(frameStats(Array.from({ length: 100 }, (_, i) => i + 1))).toEqual({ samples: 100, mean: 50.5, p50: 51, p95: 96, p99: 100 });
    expect(frameStats([]).mean).toBeNull();
  });
  it("waits for 3 stable seconds then records at least 30 seconds", () => {
    expect(STABLE_MS).toBe(3000); expect(RECORD_MS).toBe(30000);
    const h = harness();
    for (let now = 0; now < 33000; now += 1000) h.tick(now);
    expect(h.complete).not.toHaveBeenCalled(); h.tick(33000);
    const result = h.complete.mock.calls[0]?.[0];
    expect(result?.mode).toBe("legacy"); expect(result?.durationMs).toBe(30000); expect(result?.frames.samples).toBe(30); expect(result?.frames.mean).toBe(1000);
    expect(h.scheduled.size).toBe(0);
  });
  it("does not start regional recording with outstanding or prepared regions", () => {
    const h = harness("regional"); h.set({ ...readDiagnostics("regional", metrics, region), pending: 2, prepared: 1, ready: false });
    for (let now = 0; now <= 5000; now += 1000) h.tick(now);
    expect(h.progress.mock.calls.at(-1)?.[0]).toBe("stabilizing");
    h.set(readDiagnostics("regional", metrics, region));
    for (let now = 6000; now <= 9000; now += 1000) h.tick(now);
    expect(h.progress.mock.calls.at(-1)?.[0]).toBe("recording"); h.stop();
  });
  it("restarts stability waiting when the camera moves", () => {
    const h = harness(); h.tick(0); h.tick(1000); h.tick(2000);
    h.set({ ...readDiagnostics("legacy", metrics), camera: [1, 260, 260] });
    h.tick(3000); h.tick(4000); h.tick(5000);
    expect(h.progress.mock.calls.at(-1)?.[0]).toBe("stabilizing"); h.tick(6000);
    expect(h.progress.mock.calls.at(-1)?.[0]).toBe("recording"); h.stop();
  });
  it("keeps samples of outstanding regions and errors during measurement", () => {
    const h = harness("regional"); for (let now = 0; now <= 3000; now += 1000) h.tick(now);
    h.set({ ...readDiagnostics("regional", metrics, region), pending: 2, ready: false, errors: ["regional error"] });
    for (let now = 4000; now <= 33000; now += 1000) h.tick(now);
    const result = h.complete.mock.calls[0]?.[0];
    expect(result?.samples.some((s) => s.pending === 2)).toBe(true);
    expect(result?.samples.at(-1)?.errors).toEqual(["regional error"]);
  });
  it("cancels when the actual mode changes, without switching it", () => {
    const h = harness(); h.tick(0); h.set(readDiagnostics("regional", metrics, region)); h.tick(1000);
    expect(h.error).toHaveBeenCalledOnce(); expect(h.complete).not.toHaveBeenCalled(); expect(h.scheduled.size).toBe(0);
  });
  it("stops scheduled callbacks and samples on close", () => {
    const h = harness(); h.tick(0); h.stop(); const count = h.read.mock.calls.length; h.tick(40000);
    expect(h.scheduled.size).toBe(0); expect(h.read.mock.calls.length).toBe(count); expect(h.complete).not.toHaveBeenCalled();
  });
  it("rejects hidden measurements instead of reporting a background gap", () => {
    const h = harness(); h.tick(0); h.hide(); h.tick(1000);
    expect(h.error).toHaveBeenCalledOnce(); expect(h.scheduled.size).toBe(0);
  });
  it("times out safely when probes are unavailable", () => {
    const h = harness(); h.set(readDiagnostics("legacy")); h.tick(0); h.tick(120000);
    expect(h.error).toHaveBeenCalledOnce(); expect(h.scheduled.size).toBe(0);
  });
  it("cleans up if a reader throws", () => {
    const h = harness(); h.read.mockImplementation(() => { throw Error("bad read"); }); h.tick(0);
    expect(h.error).toHaveBeenCalledOnce(); expect(h.scheduled.size).toBe(0);
  });
  it("exports measured sessions including loading, errors and N/D without fabricated GPU data", () => {
    const h = harness("regional");
    for (let now = 0; now <= 3000; now += 1000) h.tick(now);
    h.set({ ...readDiagnostics("regional", metrics, region), gpu: null, pending: 1, errors: ["read failed"] });
    for (let now = 4000; now <= 33000; now += 1000) h.tick(now);
    const result = h.complete.mock.calls[0]?.[0];
    if (!result) throw Error("Missing session");
    const text = comparisonReport([result]);
    expect(text).toContain("Modalità effettiva: Regional");
    expect(text).toContain("Durata: 30.00 s");
    expect(text).toContain("alcuni campioni N/D");
    expect(text).toContain("Regioni ancora in caricamento durante la sessione: Sì");
    expect(text).toContain("read failed");
    expect(text).toContain("non VRAM totale");
    const missing = comparisonReport([{ ...result, samples: [readDiagnostics("regional")] }]);
    expect(missing).toContain("GPU buffer GL: N/D");
  });
});