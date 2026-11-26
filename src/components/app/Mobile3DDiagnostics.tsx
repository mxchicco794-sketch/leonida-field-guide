import { useEffect, useRef, useState } from "react";
import { Activity, Copy, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { byteLabel, comparisonReport, modeLabel, readDiagnostics, SESSION_KEY, startRecording, valueLabel, type DiagnosticMode, type DiagnosticResult, type DiagnosticSnapshot } from "@/lib/leonida/geo3d/mobile-diagnostics";

interface Props { mode: DiagnosticMode | null; routeError?: string }
interface Probes { __regionMetrics?: { report: () => unknown }; __regions3d?: { snapshot: () => unknown } }

export default function Mobile3DDiagnostics(props: Props) {
  const [open, setOpen] = useState(false);
  return <div className="pointer-events-none absolute inset-x-3 bottom-[122px] z-30">
    {open ? <DiagnosticPanel {...props} onClose={() => setOpen(false)} /> :
      <Button variant="outline" size="sm" className="pointer-events-auto shadow" onClick={() => setOpen(true)} aria-label="Apri diagnostica 3D"><Activity /> Diagnostica</Button>}
  </div>;
}

function DiagnosticPanel({ mode, routeError, onClose }: Props & { onClose: () => void }) {
  const latest = useRef({ mode, routeError }); latest.current = { mode, routeError };
  const read = () => {
    const probes = window as unknown as Probes;
    return readDiagnostics(latest.current.mode, probes.__regionMetrics?.report, probes.__regions3d?.snapshot, latest.current.routeError);
  };
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot>(() => read());
  const [results, setResults] = useState<DiagnosticResult[]>([]);
  const [progress, setProgress] = useState<{ phase: string; elapsed: number } | null>(null);
  const [recordedFrames, setRecordedFrames] = useState<DiagnosticResult["frames"] | null>(null);
  const [message, setMessage] = useState("");
  const [copyText, setCopyText] = useState("");
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "[]");
      if (Array.isArray(saved) && saved.every((r) => r && (r.mode === "legacy" || r.mode === "regional") && typeof r.durationMs === "number" && Array.isArray(r.samples) && r.frames)) setResults(saved as DiagnosticResult[]);
    } catch { setMessage("Memoria sessione non disponibile: il confronto rimane aperto solo in questa vista."); }
    const timer = window.setInterval(() => { if (!document.hidden) setSnapshot(read()); }, 1000);
    const visibility = () => {
      if (document.hidden && stop.current) {
        stop.current(); stop.current = null; setProgress(null);
        setMessage("Registrazione annullata: anteprima non visibile. Mantieni lo schermo acceso.");
      }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", visibility); stop.current?.(); stop.current = null; };
  }, []);
  useEffect(() => {
    setRecordedFrames(null);
    if (stop.current) { stop.current(); stop.current = null; setProgress(null); setMessage("Registrazione annullata: modalità o stato della scena cambiati."); }
  }, [mode]);
  const save = (next: DiagnosticResult[]) => {
    setResults(next);
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(next)); } catch { setMessage("Risultato acquisito, ma salvataggio sessione non disponibile: copia il report prima di cambiare modalità."); }
  };
  const record = (requested: DiagnosticMode) => {
    if (requested !== latest.current.mode || stop.current) return;
    setMessage(""); setCopyText(""); setRecordedFrames(null); setProgress({ phase: "stabilizing", elapsed: 0 });
    const nav = navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } };
    stop.current = startRecording({ mode: requested, read, hidden: () => document.hidden,
      request: (callback) => requestAnimationFrame(callback), cancel: (id) => cancelAnimationFrame(id),
      device: nav.userAgentData?.platform ?? nav.platform ?? "", userAgent: nav.userAgent,
      onProgress: (phase, elapsed, stats) => { setProgress({ phase, elapsed }); setRecordedFrames(stats); },
      onError: (text) => { stop.current = null; setProgress(null); setRecordedFrames(null); setMessage(text); },
      onComplete: (result) => { stop.current = null; setProgress(null); setRecordedFrames(result.frames); save([...results.filter((r) => r.mode !== result.mode), result]); },
    });
  };
  const reset = () => { stop.current?.(); stop.current = null; setProgress(null); setRecordedFrames(null); setMessage(""); setCopyText(""); save([]); };
  const copy = async () => {
    const text = comparisonReport(results);
    try { await navigator.clipboard.writeText(text); setMessage("Report copiato."); setCopyText(""); }
    catch { setCopyText(text); setMessage("Appunti non disponibili: seleziona e copia il report qui sotto."); }
  };
  const row = (label: string, value: string) => <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="text-right tabular-nums">{value}</dd></div>;
  const frames = recordedFrames && recordedFrames.samples > 0 ? recordedFrames : results.find((r) => r.mode === mode)?.frames ?? snapshot;
  return <section aria-label="Diagnostica 3D" className="pointer-events-auto max-h-[48dvh] overflow-y-auto overscroll-contain rounded-lg border border-border bg-background p-3 text-xs text-foreground shadow-xl">
    <div className="mb-2 flex items-center justify-between"><strong>Diagnostica · {modeLabel(mode)}</strong><Button variant="ghost" size="icon" onClick={onClose} aria-label="Chiudi diagnostica"><X /></Button></div>
    <dl className="space-y-1">
      {row("CPU scena", byteLabel(snapshot.cpu))}{row("CPU near", byteLabel(snapshot.nearCpu))}{row("CPU regioni", byteLabel(snapshot.regionalCpu))}
      {row("GPU buffer GL", byteLabel(snapshot.gpu))}{row("GPU near", byteLabel(snapshot.nearGpu))}
      {row("Frame medio / p50 (ms)", `${valueLabel(frames.mean)} / ${valueLabel(frames.p50)}`)}
      {row("Frame p95 / p99 (ms)", `${valueLabel(frames.p95)} / ${valueLabel(frames.p99)}`)}
      {row("Draw calls / triangoli", `${valueLabel(snapshot.calls)} / ${valueLabel(snapshot.triangles)}`)}
      {row("Residenti / richieste", `${valueLabel(snapshot.resident)} / ${valueLabel(snapshot.required)}`)}
      {row("Preparate / in attesa", `${valueLabel(snapshot.prepared)} / ${valueLabel(snapshot.pending)}`)}
    </dl>
    <p className="mt-2 text-[10px] text-muted-foreground">CPU: geometria in scena, non heap totale. GPU: buffer GL, non VRAM totale. Frame: {frames === snapshot ? "sonda 3D live; media N/D" : "intervalli rAF della registrazione"}. Altre richieste/errori: N/D.</p>
    {snapshot.errors.map((error, i) => <p key={i} className="mt-1 break-words text-destructive">{error}</p>)}
    <div className="mt-3 grid grid-cols-2 gap-2">
      <Button size="sm" variant="outline" disabled={mode !== "legacy" || progress !== null} onClick={() => record("legacy")}>REGISTRA MODALITÀ CLASSICA</Button>
      <Button size="sm" variant="outline" disabled={mode !== "regional" || progress !== null} onClick={() => record("regional")}>REGISTRA MODALITÀ REGIONALE</Button>
      <Button size="sm" variant="ghost" onClick={reset}><RotateCcw /> RESET CONFRONTO</Button>
      <Button size="sm" variant="secondary" disabled={!results.length || progress !== null} onClick={() => void copy()}><Copy /> COPIA REPORT</Button>
    </div>
    {progress && <p role="status" className="mt-2">{progress.phase === "stabilizing" ? "Attendo scena ferma e caricamenti completati…" : `Registrazione: ${Math.floor(progress.elapsed / 1000)} / 30 s`}</p>}
    <div className="mt-2 space-y-1">{results.map((r) => <p key={r.mode}>{modeLabel(r.mode)} · {(r.durationMs / 1000).toFixed(1)} s · p50 {valueLabel(r.frames.p50)} · p95 {valueLabel(r.frames.p95)} · p99 {valueLabel(r.frames.p99)} ms</p>)}</div>
    {message && <p role="status" className="mt-2 break-words">{message}</p>}
    {copyText && <textarea aria-label="Report da copiare" readOnly value={copyText} onFocus={(e) => e.currentTarget.select()} className="mt-2 h-32 w-full rounded-md border border-input bg-background p-2 text-xs" />}
  </section>;
}