import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, EyeOff } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { LocationSheet } from "@/components/app/LocationSheet";
import { filterLocations } from "@/lib/leonida/filters";
import { useProgress } from "@/lib/leonida/progress";
import type { Group, LeonidaLocation } from "@/lib/leonida/types";
import { SOURCE_REPO } from "@/lib/leonida/api";
import { useDataset } from "@/lib/leonida/queries";
import { loadProcessed, type Stage } from "@/lib/leonida/geo3d/load";

const Leonida3D = lazy(() => import("@/components/app/Leonida3D"));

export const Route = createFileRoute("/map3d")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { id?: string } => typeof s["id"] === "string" ? { id: s["id"] } : {},
  head: () => ({
    meta: [
      { title: "Stylized 3D Map — Leonida Companion" },
      { name: "description", content: "Optional stylized 3D view of Leonida built from the Open GTA 6 Map coastline, roads, rails and districts." },
      { property: "og:title", content: "Stylized 3D Map — Leonida Companion" },
      { property: "og:description", content: "Stylized 3D view of Leonida from the Open GTA 6 Map data." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Map3DPage,
});

function Map3DPage() {
  const { id } = Route.useSearch();
  const [stage, setStage] = useState<Stage>("checking-cache");
  const geo = useQuery({ queryKey: ["leonida", "geo3d"], queryFn: () => loadProcessed({ onStage: setStage }), staleTime: Infinity, gcTime: 60_000, retry: 1 });
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
        <Button asChild variant="outline" size="icon" className="glass shrink-0 rounded-full"><Link to="/map" search={returnId ? { id: returnId } : {}} aria-label="Back to 2D map"><ArrowLeft className="size-4" /></Link></Button>
        <div className="glass rounded-full border border-border px-3 py-2 text-xs">
          <span className="font-semibold text-primary">3D · Stylized</span> <span className="text-muted-foreground">— not the in-game map</span>
        </div>
      </div>
      <div className="absolute inset-x-0 top-16 z-10 px-3">
        <div className="flex gap-2 overflow-x-auto pb-2 [scrollbar-width:none]" aria-label="3D category filters">
          {(["Collectibles", "Activities", "Crime", "Places", "Other"] as Group[]).map((group) => (
            <Button key={group} size="sm" variant={groups.includes(group) ? "default" : "outline"}
              aria-pressed={groups.includes(group)} className="shrink-0 rounded-full"
              onClick={() => setGroups(groups.includes(group) ? groups.filter((g) => g !== group) : [...groups, group])}>{group}</Button>
          ))}
        </div>
        <div className="flex gap-2">
          <select aria-label="Filter 3D by district" value={district} onChange={(e) => setDistrict(e.target.value)} className="glass h-9 min-w-0 flex-1 rounded-md border border-border px-2 text-xs">
            <option value="">All districts</option>
            {data?.districts.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
          </select>
          <Button size="sm" variant="outline" className="glass h-9 shrink-0" aria-pressed={hideFound} onClick={() => setHideFound(!hideFound)}><EyeOff /> Hide found</Button>
        </div>
        {isError && !data && <p className="mt-2 text-xs text-muted-foreground">Locations could not load. The 3D geometry remains available.</p>}
      </div>
      {geo.isError ? msg("Could not load the map geometry. Connect to the internet and try again.")
        : !geo.data ? <Loading stage={stage} />
        : <Suspense fallback={msg("Preparing 3D view…")}><Leonida3D data={geo.data.data} districts={data?.districts ?? []} pins={{ locations: visible, kindMap, found, focusId: id, onSelect: select }} /></Suspense>}
      <p className="glass absolute bottom-[76px] left-3 right-3 rounded-xl border border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        Building heights are stylized estimates, not official GTA VI data. Drag to pan, pinch to zoom, two fingers to tilt. Data: <a className="underline" href={SOURCE_REPO} target="_blank" rel="noreferrer">Open GTA 6 Map</a> · CC BY 4.0
      </p>
      {selected && <LocationSheet loc={selected} kind={kindMap.get(selected.kind)} onClose={() => setSelected(null)} />}
    </div>
  );
}

const STAGE_TEXT: Record<Stage, [string, string]> = {
  "checking-cache": ["Checking saved map…", "Looking for an already prepared copy on this device."],
  "loading-cache": ["Loading saved map…", "Using the copy prepared on this device."],
  processing: ["Preparing the map for the first time…", "Downloading and processing coastline, roads and rails in the background. Next time it opens faster."],
  "processing-fallback": ["Preparing the map (fallback)…", "Background processing failed; preparing on the main thread. The screen may feel slower."],
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
