import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, EyeOff, Layers } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { LocationSheet } from "@/components/app/LocationSheet";
import { filterLocations } from "@/lib/leonida/filters";
import { useProgress } from "@/lib/leonida/progress";
import type { Group, LeonidaLocation } from "@/lib/leonida/types";
import { SOURCE_REPO } from "@/lib/leonida/api";
import { useDataset } from "@/lib/leonida/queries";
import { groupLabel } from "@/lib/leonida/italian";
import { loadProcessed, type Stage } from "@/lib/leonida/geo3d/load";
import { loadRegional, type SelectedGeometry } from "@/lib/leonida/geo3d/regional-load";

const Leonida3D = lazy(() => import("@/components/app/Leonida3D"));
const Mobile3DDiagnostics = import.meta.env.DEV ? lazy(() => import("@/components/app/Mobile3DDiagnostics")) : null;

export const Route = createFileRoute("/map3d")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { id?: string; detail?: "regional" } => ({ ...(typeof s["id"] === "string" ? { id: s["id"] } : {}), ...(s["detail"] === "regional" ? { detail: "regional" as const } : {}) }),
  head: () => ({
    meta: [
      { title: "Mappa 3D stilizzata — Leonida Companion" },
      { name: "description", content: "Vista 3D stilizzata facoltativa di Leonida, realizzata usando coste, strade, ferrovie e distretti di Open GTA 6 Map." },
      { property: "og:title", content: "Mappa 3D stilizzata — Leonida Companion" },
      { property: "og:description", content: "Vista 3D stilizzata di Leonida basata sui dati di Open GTA 6 Map." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Map3DPage,
});

function Map3DPage() {
  const { id, detail } = Route.useSearch();
  const [stage, setStage] = useState<Stage>("checking-cache");
  // Zero inactive retention prevents an old full legacy dataset surviving a mode change.
  const geo = useQuery({ queryKey: ["leonida", "geo3d", detail ?? "legacy"], queryFn: async ({ signal }): Promise<SelectedGeometry> => detail === "regional" ? loadRegional({ onStage: setStage, signal }) : { mode: "legacy", loaded: await loadProcessed({ onStage: setStage, signal }) }, networkMode: "always", staleTime: Infinity, gcTime: 0, retry: 1 });
  const { data, kindMap, isError } = useDataset();
  const { found } = useProgress();
  const [groups, setGroups] = useState<Group[]>(["Collectibles", "Activities"]);
  const [district, setDistrict] = useState("");
  const [hideFound, setHideFound] = useState(false);
  const [selected, setSelected] = useState<LeonidaLocation | null>(null);
  const [returnId, setReturnId] = useState<string | undefined>(id);
  const visible = useMemo(() => filterLocations(data?.locations ?? [], {
    groups, kindMap, district: data?.districts.find((d) => d.name === district), hideFound, found, focusId: id,
  }), [data, groups, kindMap, district, hideFound, found, id]);
  useEffect(() => {
    const loc = data?.locations.find((l) => l.id === id);
    if (loc) { setSelected(loc); setReturnId(loc.id); }
  }, [data, id]);
  const select = (loc: LeonidaLocation) => { setSelected(loc); setReturnId(loc.id); };
  const msg = (t: string) => <div className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground">{t}</div>;
  return (
    <div className="fixed inset-0 mx-auto max-w-md pb-[68px]">
      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 p-3">
        <Button asChild variant="outline" size="icon" className="glass shrink-0 rounded-full"><Link to="/map" search={returnId ? { id: returnId } : {}} aria-label="Torna alla mappa 2D"><ArrowLeft className="size-4" /></Link></Button>
        <div className="glass rounded-full border border-border px-3 py-2 text-xs">
          <span className="font-semibold text-primary">3D · Stilizzata</span> <span className="text-muted-foreground">— non è la mappa del gioco</span>
        </div>
        <Button asChild variant="outline" size="icon" className="glass shrink-0 rounded-full"><Link to="/map3d" search={{ ...(id ? { id } : {}), ...(detail ? {} : { detail: "regional" }) }} aria-label={detail ? "Usa il caricamento classico" : "Prova il caricamento regionale"} title={detail ? "Usa il caricamento classico" : "Prova il caricamento regionale"}><Layers className="size-4" /></Link></Button>
      </div>
      <div className="absolute inset-x-0 top-16 z-10 px-3">
        <div className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none]" aria-label="Filtri delle categorie 3D">
          {(["Collectibles", "Activities", "Crime", "Places", "Other"] as Group[]).map((group) => (
            <Button key={group} size="sm" variant={groups.includes(group) ? "default" : "outline"}
              aria-pressed={groups.includes(group)} className="shrink-0 rounded-full"
              onClick={() => setGroups(groups.includes(group) ? groups.filter((g) => g !== group) : [...groups, group])}>{groupLabel(group)}</Button>
          ))}
        </div>
        <div className="flex gap-2">
          <select aria-label="Filtra la mappa 3D per distretto" value={district} onChange={(e) => setDistrict(e.target.value)} className="glass h-9 min-w-0 flex-1 rounded-md border border-border px-2 text-xs">
            <option value="">Tutti i distretti</option>
            {data?.districts.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
          </select>
          <Button size="sm" variant="outline" className="glass h-9 shrink-0" aria-pressed={hideFound} onClick={() => setHideFound(!hideFound)}><EyeOff /> Nascondi quelli trovati</Button>
        </div>
        {isError && !data && <p className="mt-2 text-xs text-muted-foreground">Impossibile caricare i luoghi. La geometria 3D è comunque disponibile.</p>}
      </div>
      {geo.isError ? msg("Impossibile caricare la geometria della mappa. Connettiti a Internet e riprova.")
        : !geo.data ? <Loading stage={stage} />
        : <Suspense fallback={msg("Preparazione della vista 3D…")}><Leonida3D key={detail ?? "legacy"} data={geo.data.mode === "regional" ? geo.data.prepared.global : geo.data.loaded.data} {...(geo.data.mode === "regional" ? { regional: geo.data.prepared } : {})} districts={data?.districts ?? []} pins={{ locations: visible, kindMap, found, focusId: id, onSelect: select }} /></Suspense>}
      <p className="glass absolute bottom-[76px] left-3 right-3 rounded-xl border border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        Le altezze degli edifici sono stime stilizzate, non dati ufficiali di GTA VI. Trascina per spostarti, pizzica per ingrandire e usa due dita per inclinare. Dati: <a className="underline" href={SOURCE_REPO} target="_blank" rel="noreferrer">Open GTA 6 Map</a> · CC BY 4.0
      </p>
      {selected && <LocationSheet loc={selected} kind={kindMap.get(selected.kind)} onClose={() => setSelected(null)} />}
      {Mobile3DDiagnostics && <Suspense fallback={null}><Mobile3DDiagnostics mode={geo.data?.mode ?? null} {...(geo.isError ? { routeError: "Caricamento geometria fallito." } : {})} /></Suspense>}
    </div>
  );
}

const STAGE_TEXT: Record<Stage, [string, string]> = {
  "checking-cache": ["Controllo della mappa salvata…", "Ricerca di una copia già preparata su questo dispositivo."],
  "loading-cache": ["Caricamento della mappa salvata…", "Viene utilizzata la copia preparata su questo dispositivo."],
  processing: ["Prima preparazione della mappa…", "Download ed elaborazione in background di coste, strade e ferrovie. La prossima apertura sarà più rapida."],
  "processing-fallback": ["Preparazione della mappa (modalità alternativa)…", "L’elaborazione in background non è riuscita: la mappa viene preparata sul thread principale. La schermata potrebbe risultare meno fluida."],
};

function Loading({ stage }: { stage: Stage }) {
  const [title, sub] = STAGE_TEXT[stage];
  return (
    <div className="grid h-full place-items-center p-8 text-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <span className="size-8 animate-spin rounded-full border-2 border-border border-t-primary" />
        <p className="text-sm font-semibold">{title}</p>
        <p className="max-w-64 text-xs text-muted-foreground">{sub}</p>
      </div>
    </div>
  );
}
