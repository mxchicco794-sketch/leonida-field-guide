/** Preview-only consumer of existing probes. No renderer, stream or cache ownership. */
export type DiagnosticMode = "legacy" | "regional";
export const RECORD_MS = 30_000;
export const STABLE_MS = 3_000;
type Bag = Record<string, unknown>;
const bag = (v: unknown): Bag => v !== null && typeof v === "object" ? v as Bag : {};
const number = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
export interface DiagnosticSnapshot {
  mode: DiagnosticMode | null;
  cpu: number | null; nearCpu: number | null; regionalCpu: number | null;
  gpu: number | null; nearGpu: number | null;
  mean: number | null; p50: number | null; p95: number | null; p99: number | null;
  calls: number | null; triangles: number | null;
  resident: number | null; required: number | null; prepared: number | null; pending: number | null;
  ready: boolean | null; camera: number[] | null; target: number[] | null; errors: string[];
}
function vector(v: unknown): number[] | null {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n)) ? v as number[] : null;
}
export function readDiagnostics(mode: DiagnosticMode | null, metrics?: () => unknown, regions?: () => unknown, routeError?: string): DiagnosticSnapshot {
  const errors: string[] = routeError ? [routeError] : [];
  let m: Bag = {}, r: Bag = {};
  try { m = bag(metrics?.()); } catch (e) { errors.push(`Metriche: ${String(e)}`); }
  if (mode === "regional") try { r = bag(regions?.()); } catch (e) { errors.push(`Regioni: ${String(e)}`); }
  if (typeof r["error"] === "string") errors.push(r["error"]);
  const frame = bag(m["frameMs"]), render = bag(m["render"]);
  return {
    mode, cpu: number(m["sceneCpuBytes"]), nearCpu: number(m["nearCpuBytes"]), regionalCpu: number(r["cpuBytes"]),
    gpu: number(m["gpuBufferBytes"]), nearGpu: number(m["gpuNearBufferBytes"]),
    mean: null, p50: number(frame["median"]), p95: number(frame["p95"]), p99: number(frame["p99"]),
    calls: number(render["calls"]), triangles: number(render["triangles"]),
    resident: number(r["resident"]), required: number(r["required"]), prepared: number(r["prepared"]), pending: number(r["pending"]),
    ready: typeof r["ready"] === "boolean" ? r["ready"] : null,
    camera: vector(m["camera"]), target: vector(m["target"]), errors,
  };
}
export function frameStats(values: number[]) {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
  return { samples: sorted.length, mean: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null, p50: q(0.5), p95: q(0.95), p99: q(0.99) };
}
export interface DiagnosticResult {
  mode: DiagnosticMode; startedAt: string; durationMs: number; device: string; userAgent: string;
  frames: ReturnType<typeof frameStats>; samples: DiagnosticSnapshot[];
}
export interface RecorderOptions {
  mode: DiagnosticMode; read: () => DiagnosticSnapshot; hidden: () => boolean;
  request: (callback: (now: number) => void) => number; cancel: (id: number) => void;
  device: string; userAgent: string;
  onProgress: (phase: "stabilizing" | "recording", elapsed: number, stats: ReturnType<typeof frameStats>) => void;
  onComplete: (result: DiagnosticResult) => void; onError: (message: string) => void;
}
function signature(s: DiagnosticSnapshot) {
  return JSON.stringify([s.mode, s.camera, s.target, s.resident, s.required, s.prepared, s.pending, s.ready, s.calls, s.triangles, s.cpu, s.gpu]);
}
/** Only active during an explicit recording. Stop cancels the sole scheduled callback. */
export function startRecording(o: RecorderOptions): () => void {
  let stopped = false, handle = 0, stableSince = 0, previous = "", phase: "stabilizing" | "recording" = "stabilizing";
  let start = 0, last = 0, lastRead = -Infinity, waitingStart: number | null = null, startedAt = "";
  const frames: number[] = [], samples: DiagnosticSnapshot[] = [];
  const stop = () => { stopped = true; o.cancel(handle); };
  const fail = (message: string) => { stop(); o.onError(message); };
  const tick = (now: number) => {
    if (stopped) return;
    if (o.hidden()) { fail("Registrazione annullata: anteprima non visibile. Mantieni lo schermo acceso."); return; }
    if (phase === "recording" && last) frames.push(now - last);
    last = now;
    if (now - lastRead >= 1000) {
      lastRead = now;
      let s: DiagnosticSnapshot;
      try { s = o.read(); } catch (e) { fail(`Lettura diagnostica fallita: ${String(e)}`); return; }
      if (s.mode !== o.mode) { fail("Registrazione annullata: modalità effettiva cambiata o scena non pronta."); return; }
      if (phase === "stabilizing") {
        waitingStart ??= now;
        const available = s.camera !== null && s.target !== null && s.calls !== null && !s.errors.length;
        const ready = o.mode === "legacy" || (s.ready === true && s.pending === 0 && s.prepared === 0);
        const key = signature(s);
        if (!available || !ready || key !== previous) { stableSince = now; previous = key; }
        if (available && ready && now - stableSince >= STABLE_MS) {
          phase = "recording"; start = now; startedAt = new Date().toISOString(); frames.length = 0; samples.push(s);
        } else if (now - waitingStart >= 120_000) { fail("Scena non stabilizzata entro 120 secondi o metriche N/D. Riprova con la mappa ferma."); return; }
      } else samples.push(s);
      o.onProgress(phase, phase === "recording" ? now - start : 0, frameStats(frames));
    }
    if (phase === "recording" && now - start >= RECORD_MS) {
      // Include the final state even if the last second's poll was slightly earlier.
      let s: DiagnosticSnapshot;
      try { s = o.read(); } catch (e) { fail(`Lettura diagnostica fallita: ${String(e)}`); return; }
      if (s.mode !== o.mode) { fail("Registrazione annullata: modalità effettiva cambiata."); return; }
      samples.push(s); stop();
      o.onComplete({ mode: o.mode, startedAt, durationMs: now - start, device: o.device, userAgent: o.userAgent, frames: frameStats(frames), samples });
      return;
    }
    handle = o.request(tick);
  };
  handle = o.request(tick);
  return stop;
}
export const SESSION_KEY = "leonida-preview-diagnostics-v1";
export const modeLabel = (mode: DiagnosticMode | null) => mode === "legacy" ? "Legacy" : mode === "regional" ? "Regional" : "N/D";
export const valueLabel = (value: number | null) => value === null ? "N/D" : value.toLocaleString("it-IT", { maximumFractionDigits: 2 });
export const byteLabel = (value: number | null) => value === null ? "N/D" : `${valueLabel(value)} B · ${(value / 1048576).toFixed(2)} MiB`;
function range(samples: DiagnosticSnapshot[], key: keyof DiagnosticSnapshot, bytes = false) {
  const values = samples.map((s) => s[key]).filter((v): v is number => typeof v === "number");
  const format = bytes ? byteLabel : valueLabel;
  if (!values.length) return "N/D";
  return `min ${format(Math.min(...values))}; max ${format(Math.max(...values))}; finale ${format(number(samples.at(-1)?.[key]))}${values.length < samples.length ? "; alcuni campioni N/D" : ""}`;
}
export function comparisonReport(results: DiagnosticResult[]) {
  const header = "LEONIDA COMPANION — diagnostica mobile preview\nCPU: buffer della geometria in scena, non heap totale. CPU regioni: residenti + preparate, se disponibile.\nGPU: byte dei buffer GL registrati dalla sonda esistente, non VRAM totale né texture.\nFrame time: intervalli requestAnimationFrame del pannello durante la sessione, non tempo GPU; percentili della sonda 3D solo nel pannello live. Nessuna stima sostituisce N/D.\nConfrontare la stessa inquadratura, filtri e condizioni del dispositivo.\n";
  if (!results.length) return `${header}\nNessuna sessione completata.`;
  return header + results.map((r) => {
    const errors = [...new Set(r.samples.flatMap((s) => s.errors))];
    return `\nModalità effettiva: ${modeLabel(r.mode)}\nData: ${r.startedAt}\nDispositivo: ${r.device || "N/D"}\nUser agent: ${r.userAgent || "N/D"}\nDurata: ${(r.durationMs / 1000).toFixed(2)} s; campioni frame: ${r.frames.samples}; campioni stato: ${r.samples.length}\nFrame ms — medio ${valueLabel(r.frames.mean)}; p50 ${valueLabel(r.frames.p50)}; p95 ${valueLabel(r.frames.p95)}; p99 ${valueLabel(r.frames.p99)}\nCPU scena: ${range(r.samples, "cpu", true)}\nCPU near: ${range(r.samples, "nearCpu", true)}\nCPU regioni: ${range(r.samples, "regionalCpu", true)}\nGPU buffer GL: ${range(r.samples, "gpu", true)}\nGPU near: ${range(r.samples, "nearGpu", true)}\nDraw calls: ${range(r.samples, "calls")}\nTriangoli: ${range(r.samples, "triangles")}\nRegioni residenti: ${range(r.samples, "resident")}\nRegioni richieste: ${range(r.samples, "required")}\nRegioni preparate: ${range(r.samples, "prepared")}\nRegioni in attesa: ${range(r.samples, "pending")}\nRegioni ancora in caricamento durante la sessione: ${r.mode === "legacy" ? "N/D (Legacy)" : r.samples.some((s) => (s.pending ?? 0) > 0 || (s.prepared ?? 0) > 0 || s.ready === false) ? "Sì" : r.samples.every((s) => s.ready !== null && s.pending !== null && s.prepared !== null) ? "No" : "N/D"}\nCamera iniziale/finale: ${JSON.stringify(r.samples[0]?.camera ?? null)} / ${JSON.stringify(r.samples.at(-1)?.camera ?? null)}\nTarget iniziale/finale: ${JSON.stringify(r.samples[0]?.target ?? null)} / ${JSON.stringify(r.samples.at(-1)?.target ?? null)}\nErrori osservati dalle sonde e dalla pagina: ${errors.join("; ") || "Nessuno"}\nErrori globali di rete/console e richieste non regionali: N/D (non esposti dalle sonde).\n`;
  }).join("\n");
}