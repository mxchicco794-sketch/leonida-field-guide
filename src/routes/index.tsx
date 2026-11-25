import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, CloudOff, Map, RefreshCw } from "lucide-react";
import { Attribution, StateMessage } from "@/components/app/AppShell";
import { useProgress } from "@/lib/leonida/progress";
import { useDataset } from "@/lib/leonida/queries";
import { groupProgress } from "@/lib/leonida/stats";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Leonida Companion — GTA 6 Fan Companion" },
      { name: "description", content: "Your GTA 6 companion: explore the Leonida map, track collectibles and save favorite spots." },
      { property: "og:title", content: "Leonida Companion — GTA 6 Fan Companion" },
      { property: "og:description", content: "Explore the Leonida map, track collectibles and save favorite spots." },
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
        <p className="font-display text-xs font-semibold uppercase tracking-[0.35em] text-primary animate-rise">State of Leonida</p>
        <h1 className="mt-2 font-display text-4xl font-bold uppercase leading-none tracking-wide animate-rise">Leonida<br />Companion</h1>
        <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
          {data?.source === "cache" ? <CloudOff className="size-3.5" /> : <RefreshCw className={isFetching ? "size-3.5 animate-spin" : "size-3.5"} />}
          {data ? `${data.source === "cache" ? "Offline copy" : "Synced"} · ${new Date(data.syncedAt).toLocaleString()}` : isLoading ? "Syncing data…" : "Not synced"}
          <button onClick={() => refetch()} className="ml-auto rounded-full border border-border px-3 py-1 font-semibold text-foreground">Sync</button>
        </div>
      </section>

      {isError && !data && <div className="mt-5"><StateMessage title="Data unavailable" body="Connect to the internet once to download the Leonida data." /></div>}

      {data && (
        <div className="space-y-4 px-5 pt-5">
          <Link to="/map" className="group flex items-center gap-4 rounded-2xl bg-red p-5 text-primary-foreground shadow-glow animate-rise">
            <Map className="size-8" />
            <div className="flex-1">
              <p className="font-display text-lg font-bold uppercase">Open the map</p>
              <p className="text-sm opacity-80">{data.locations.length.toLocaleString()} mapped locations</p>
            </div>
            <ArrowRight className="size-5 transition group-hover:translate-x-1" />
          </Link>

          <div className="grid grid-cols-3 gap-3 animate-rise">
            <Stat label="Completion" value={`${pct}%`} />
            <Stat label="Favorites" value={favorites.length} />
            <Stat label="Areas" value={areas} />
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 animate-rise">
            <div className="flex items-baseline justify-between">
              <p className="font-display font-semibold uppercase tracking-wide">Collectibles</p>
              <p className="text-sm text-muted-foreground">{done} / {total}</p>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-red transition-all" style={{ width: `${pct}%` }} /></div>
            <ul className="mt-4 space-y-2">
              {collectibles.slice(0, 5).map((r) => (
                <li key={r.kind.key} className="flex items-center gap-3 text-sm">
                  <span>{r.kind.icon}</span><span className="flex-1 truncate">{r.kind.name}</span>
                  <span className="text-muted-foreground">{r.found}/{r.total}</span>
                </li>
              ))}
            </ul>
            <Link to="/collectibles" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">All collectibles <ArrowRight className="size-4" /></Link>
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
