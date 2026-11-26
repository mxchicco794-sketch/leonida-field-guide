import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CloudOff, Map, RefreshCw } from "lucide-react";
import { Attribution, StateMessage } from "@/components/app/AppShell";
import { useProgress } from "@/lib/leonida/progress";
import { useDataset } from "@/lib/leonida/queries";
import { groupProgress } from "@/lib/leonida/stats";
import { kindLabel } from "@/lib/leonida/italian";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Leonida Companion — guida di GTA 6" },
      { name: "description", content: "La tua guida a GTA 6: esplora la mappa di Leonida, tieni traccia dei collezionabili e salva i tuoi luoghi preferiti." },
      { property: "og:title", content: "Leonida Companion — GTA 6 Fan Companion" },
      { property: "og:description", content: "Esplora la mappa di Leonida, segui i tuoi collezionabili e salva i luoghi preferiti." },
    ],
  }),
  component: Discover,
});

function Discover() {
  const { data, isLoading, isError, isFetching, refetch } = useDataset();
  const { found, favorites } = useProgress();
  const collectibles = data ? groupProgress(data.locations, data.categories.kinds, "Collectibles", found) : [];
  const total = collectibles.reduce((s, r) => s + r.total, 0);
  const done = collectibles.reduce((s, r) => s + r.found, 0);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const areas = data ? [...new Set(data.locations.map((l) => l.area).filter(Boolean))].length : 0;

  return (
    <div>
      <section className="bg-hero px-5 pb-8 pt-10">
        <p className="font-display text-xs font-semibold uppercase tracking-[0.35em] text-primary animate-rise">Leonida da esplorare</p>
        <h1 className="mt-2 font-display text-4xl font-bold uppercase leading-none tracking-wide animate-rise">Leonida<br />Companion</h1>
        <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
          {data?.source === "cache" ? <CloudOff className="size-3.5" /> : <RefreshCw className={isFetching ? "size-3.5 animate-spin" : "size-3.5"} />}
          {data ? `${data.source === "cache" ? "Copia offline" : "Sincronizzato"} · ${new Date(data.syncedAt).toLocaleString()}` : isLoading ? "Sincronizzazione dei dati…" : "Non sincronizzato"}
          <button onClick={() => refetch()} className="ml-auto rounded-full border border-border px-3 py-1 font-semibold text-foreground">Sincronizza</button>
        </div>
      </section>

      {isError && !data && <div className="mt-5"><StateMessage title="Dati non disponibili" body="Connettiti a Internet una volta per scaricare i dati di Leonida." /></div>}

      {data && (
        <div className="space-y-4 px-5 pt-5">
          <Link to="/map" className="group flex items-center gap-4 rounded-2xl bg-red p-5 text-primary-foreground shadow-glow animate-rise">
            <Map className="size-8" />
            <div className="flex-1">
              <p className="font-display text-lg font-bold uppercase">Apri la mappa</p>
              <p className="text-sm opacity-80">{data.locations.length.toLocaleString()} luoghi sulla mappa</p>
            </div>
            <ArrowRight className="size-5 transition group-hover:translate-x-1" />
          </Link>

          <div className="grid grid-cols-3 gap-3 animate-rise">
            <Stat label="Completamento" value={`${pct}%`} />
            <Stat label="Preferiti" value={favorites.length} />
            <Stat label="Zone" value={areas} />
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 animate-rise">
            <div className="flex items-baseline justify-between">
              <p className="font-display font-semibold uppercase tracking-wide">Collezionabili</p>
              <p className="text-sm text-muted-foreground">{done} / {total}</p>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-red transition-all" style={{ width: `${pct}%` }} /></div>
            <ul className="mt-4 space-y-2">
              {collectibles.slice(0, 5).map((r) => (
                <li key={r.kind.key} className="flex items-center gap-3 text-sm">
                  <span>{r.kind.icon}</span><span className="flex-1 truncate">{kindLabel(r.kind)}</span>
                  <span className="text-muted-foreground">{r.found}/{r.total}</span>
                </li>
              ))}
            </ul>
            <Link to="/collectibles" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">Tutti i collezionabili <ArrowRight className="size-4" /></Link>
          </div>
        </div>
      )}
      <Attribution />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="font-display text-2xl font-bold">{value}</p>
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}
