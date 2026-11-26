import { ClientOnly, createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { EyeOff, Layers, Moon, Search, Sun, X } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { LocationSheet } from "@/components/app/LocationSheet";
import { fold, inRings } from "@/lib/leonida/cluster";
import { useProgress } from "@/lib/leonida/progress";
import { geometryQuery, useDataset } from "@/lib/leonida/queries";
import type { Group, LeonidaLocation } from "@/lib/leonida/types";
import { cn } from "@/lib/utils";
import { groupLabel, kindLabel } from "@/lib/leonida/italian";

const LeonidaMap = lazy(() => import("@/components/app/LeonidaMap"));

export const Route = createFileRoute("/map")({
  validateSearch: (s: Record<string, unknown>): { id?: string } => (typeof s["id"] === "string" ? { id: s["id"] } : {}),
  head: () => ({
    meta: [
      { title: "Mappa di Leonida — Leonida Companion" },
      { name: "description", content: "Mappa interattiva di Leonida con collezionabili, attività e luoghi dal progetto Open GTA 6 Map." },
      { property: "og:title", content: "Mappa di Leonida — Leonida Companion" },
      { property: "og:description", content: "Mappa interattiva di Leonida con collezionabili, attività e luoghi." },
    ],
  }),
  component: MapPage,
});

const GROUPS: Group[] = ["Collectibles", "Activities", "Crime", "Places", "Other"];
const Loading = () => <div className="grid h-full place-items-center text-sm text-muted-foreground">Caricamento della mappa di Leonida…</div>;

function MapPage() {
  const { id } = Route.useSearch();
  const { data, kindMap, isError } = useDataset();
  const { found } = useProgress();
  const [groups, setGroups] = useState<Group[]>(["Collectibles", "Activities"]);
  const [style, setStyle] = useState<"night" | "day">("night");
  const [vector, setVector] = useState(false);
  const geo = useQuery({ ...geometryQuery, enabled: vector });
  const [selected, setSelected] = useState<LeonidaLocation | null>(null);
  const [district, setDistrict] = useState("");
  const [hideFound, setHideFound] = useState(false);
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState<string | undefined>(undefined);
  const focusId = focus ?? id;

  const visible = useMemo(() => {
    const d = data?.districts.find((x) => x.name === district);
    const f = hideFound ? new Set(found) : null;
    return (data?.locations ?? []).filter((l) => l.id === focusId || (
      groups.includes(kindMap.get(l.kind)?.group ?? "Other") && (!d || inRings(l.x, l.y, d.rings)) && !f?.has(l.id)));
  }, [data, groups, kindMap, focusId, district, hideFound, found]);

  const results = useMemo(() => {
    const t = fold(q.trim());
    if (t.length < 2 || !data) return [];
    return data.locations.filter((l) => fold([l.name, l.type, l.area, l.region, l.real_life, l.description, kindMap.get(l.kind)?.name, kindLabel(kindMap.get(l.kind))].filter(Boolean).join(" ")).includes(t)).slice(0, 30);
  }, [q, data, kindMap]);

  return (
    <div className="fixed inset-0 mx-auto max-w-md pb-[68px]">
      <div className="absolute inset-x-0 top-0 z-[999] flex gap-2 overflow-x-auto p-3 [scrollbar-width:none]">
        <button onClick={() => setStyle(style === "night" ? "day" : "night")} aria-label="Cambia lo stile della mappa" className="glass shrink-0 rounded-full border border-border p-2.5">
          {style === "night" ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </button>
        <button onClick={() => setVector(!vector)} aria-label="Attiva o disattiva la sovrapposizione vettoriale" aria-pressed={vector} className={cn("shrink-0 rounded-full border p-2.5", vector ? "border-primary text-primary glass" : "glass border-border")}>
          <Layers className={cn("size-4", vector && geo.isFetching && "animate-pulse")} />
        </button>
        <Link to="/map3d" aria-label="Apri la mappa 3D stilizzata" className="glass shrink-0 rounded-full border border-border px-3 py-2 text-xs font-semibold">3D</Link>
        {GROUPS.map((g) => {
          const on = groups.includes(g);
          return (
            <button key={g} onClick={() => setGroups(on ? groups.filter((x) => x !== g) : [...groups, g])}
              className={cn("shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition", on ? "border-primary bg-red text-primary-foreground" : "glass border-border text-muted-foreground")}>
              {groupLabel(g)}
            </button>
          );
        })}
      </div>
      <div className="absolute inset-x-0 top-14 z-[999] px-3">
        <div className="glass flex items-center gap-2 rounded-full border border-border px-3">
          <Search className="size-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca luoghi, collezionabili e zone…" aria-label="Cerca sulla mappa" className="h-10 flex-1 bg-transparent text-sm outline-none" />
          {q && <button aria-label="Cancella la ricerca" onClick={() => setQ("")}><X className="size-4" /></button>}
        </div>
        {results.length > 0 && (
          <ul className="glass mt-2 max-h-72 overflow-y-auto rounded-2xl border border-border">
            {results.map((l) => (
              <li key={l.id}><button onClick={() => { setFocus(l.id); setQ(""); }} className="w-full px-4 py-2.5 text-left">
                <p className="truncate text-sm font-semibold">{kindMap.get(l.kind)?.icon} {l.name}</p>
                <p className="truncate text-xs text-muted-foreground">{[kindLabel(kindMap.get(l.kind)), l.area].filter(Boolean).join(" · ")}</p>
              </button></li>
            ))}
          </ul>
        )}
        {q.trim().length >= 2 && results.length === 0 && <p className="glass mt-2 rounded-2xl border border-border px-4 py-3 text-xs text-muted-foreground">Nessun risultato nei dati della mappa.</p>}
        <div className="mt-2 flex gap-2">
          <select value={district} onChange={(e) => setDistrict(e.target.value)} aria-label="Filtra per distretto" className="glass h-9 flex-1 rounded-full border border-border bg-transparent px-3 text-xs">
            <option value="">Tutti i distretti</option>
            {(data?.districts ?? []).map((d, i) => <option key={`${d.name}-${i}`} value={d.name}>{d.name}</option>)}
          </select>
          <button onClick={() => setHideFound(!hideFound)} aria-pressed={hideFound} className={cn("glass flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold", hideFound ? "border-primary text-primary" : "border-border text-muted-foreground")}>
            <EyeOff className="size-3.5" /> Nascondi quelli trovati
          </button>
        </div>
      </div>
      {isError && !data ? (
        <div className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground">Impossibile caricare i dati della mappa. Connettiti a Internet una volta per sincronizzarli.</div>
      ) : (
        <ClientOnly fallback={<Loading />}>
          <Suspense fallback={<Loading />}>
            <LeonidaMap locations={visible} districts={data?.districts ?? []} routes={data?.routes ?? []} geometry={vector ? geo.data : undefined} kindMap={kindMap} found={found} style={style} focusId={focusId} onSelect={setSelected} />
          </Suspense>
        </ClientOnly>
      )}
      {selected && <LocationSheet loc={selected} kind={kindMap.get(selected.kind)} onClose={() => setSelected(null)} />}
    </div>
  );
}
