/** Residency state is independent of React and Three. Visible coverage is never budget-evicted. */
import type { RegionManifest, RegionMeta, RegionPayload } from "./regions";
import { assertRegion } from "./regions";

export const MAX_REGION_READS = 2, MAX_RETAINED_REGIONS = 2, RETAINED_BYTES = 1024 * 1024, RETAIN_MS = 1500;
interface Resident<R> { resource: R; bytes: number; lastNeeded: number }
interface Pending { controller: AbortController }
export interface StreamOptions<R> {
  manifest: RegionManifest;
  read: (id: string, signal: AbortSignal) => Promise<RegionPayload>;
  install: (payload: RegionPayload, meta: RegionMeta) => { resource: R; bytes: number };
  dispose: (resource: R) => void;
}

export class RegionStream<R> {
  readonly residents = new Map<string, Resident<R>>();
  private prepared = new Map<string, RegionPayload>();
  private pending = new Map<string, Pending>();
  private wanted: string[] = [];
  private required = new Set<string>();
  private metadata: Map<string, RegionMeta>;
  private clock = 0;
  private disposed = false;
  error: Error | null = null;
  installs = 0;
  evictions = 0;
  constructor(private options: StreamOptions<R>) { this.metadata = new Map(options.manifest.regions.map((m) => [m.id, m])); }

  demand(required: string[], prefetch: string[], now: number) {
    if (this.disposed || this.error) return;
    this.clock = now;
    this.required = new Set(required);
    this.wanted = [...new Set([...required, ...prefetch.slice(0, MAX_RETAINED_REGIONS)])];
    const wanted = new Set(this.wanted);
    for (const [id, pending] of this.pending) if (!wanted.has(id)) { pending.controller.abort(); /* Keep its concurrency slot until rejection settles. */ }
    for (const id of this.prepared.keys()) if (!wanted.has(id)) this.prepared.delete(id);
    for (const [id, item] of this.residents) if (this.required.has(id)) item.lastNeeded = now;
    this.evict(now);
    this.pump();
  }

  private pump() {
    if (this.disposed || this.error) return;
    for (const id of this.wanted) {
      if (this.pending.size >= MAX_REGION_READS) break;
      if (this.residents.has(id) || this.prepared.has(id) || this.pending.has(id)) continue;
      const meta = this.metadata.get(id);
      if (!meta) { this.fail(new Error("Unknown demanded region")); return; }
      const controller = new AbortController();
      const pending = { controller }; this.pending.set(id, pending);
      this.options.read(id, controller.signal).then((payload) => {
        if (this.disposed || controller.signal.aborted || !this.wanted.includes(id)) return;
        assertRegion(payload, meta);
        this.prepared.set(id, payload);
      }).catch((e: unknown) => {
        if (!this.disposed && !controller.signal.aborted) this.fail(e instanceof Error ? e : new Error(String(e)));
      }).finally(() => { if (this.pending.get(id) === pending) this.pending.delete(id); this.pump(); });
    }
  }

  /** At most one installation, including a complete road-kind payload, per frame call. */
  frame(now: number, allowInstall = true): string | null {
    if (this.disposed || this.error) return null;
    this.clock = now;
    let installed: string | null = null;
    if (allowInstall) for (const id of this.wanted) {
      const payload = this.prepared.get(id), meta = this.metadata.get(id);
      if (!payload || !meta) continue;
      try {
        const item = this.options.install(payload, meta);
        this.residents.set(id, { ...item, lastNeeded: now });
        this.prepared.delete(id); this.installs++; installed = id;
      } catch (e) { this.fail(e instanceof Error ? e : new Error(String(e))); }
      break;
    }
    this.evict(now); this.pump(); return installed;
  }

  private evict(now: number) {
    const offscreen = [...this.residents].filter(([id]) => !this.required.has(id)).sort((a, b) => b[1].lastNeeded - a[1].lastNeeded);
    let count = 0, bytes = 0;
    for (const [id, item] of offscreen) {
      count++; bytes += item.bytes;
      if (count > MAX_RETAINED_REGIONS || bytes > RETAINED_BYTES || now - item.lastNeeded > RETAIN_MS) {
        this.options.dispose(item.resource); this.residents.delete(id); this.evictions++;
      }
    }
  }
  get ready() { return !this.error && [...this.required].every((id) => this.residents.has(id)); }
  isRequired(id: string) { return this.required.has(id); }
  snapshot() {
    return { resident: this.residents.size, pending: this.pending.size, prepared: this.prepared.size, required: this.required.size, ready: this.ready, installs: this.installs, evictions: this.evictions,
      cpuBytes: [...this.residents.values()].reduce((s, r) => s + r.bytes, 0) + [...this.prepared].reduce((s, [id]) => s + (this.metadata.get(id)?.bytes ?? 0), 0),
      ids: [...this.residents.keys()], error: this.error?.message ?? null };
  }
  private fail(e: Error) { this.error = e; this.dispose(); }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const p of this.pending.values()) p.controller.abort();
    this.pending.clear(); this.prepared.clear(); this.wanted = []; this.required.clear();
    for (const r of this.residents.values()) this.options.dispose(r.resource);
    this.residents.clear();
  }
}