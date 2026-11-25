import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { SOURCE_REPO } from "@/lib/leonida/api";
import { useDataset } from "@/lib/leonida/queries";
import { loadProcessed, type Stage } from "@/lib/leonida/geo3d/load";

const Leonida3D = lazy(() => import("@/components/app/Leonida3D"));

export const Route = createFileRoute("/map3d")({
  ssr: false,
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
  const [stage, setStage] = useState<Stage>("checking-cache");
  const geo = useQuery({ queryKey: ["leonida", "geo3d"], queryFn: () => loadProcessed({ onStage: setStage }), staleTime: Infinity, gcTime: 60_000, retry: 1 });
  const { data } = useDataset();
  const msg = (t: string) => <div className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground">{t}</div>;
  return (
    <div className="fixed inset-0 mx-auto max-w-md pb-[68px]">
      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2 p-3">
        <Link to="/map" aria-label="Back to 2D map" className="glass rounded-full border border-border p-2.5"><ArrowLeft className="size-4" /></Link>
        <div className="glass rounded-full border border-border px-3 py-2 text-xs">
          <span className="font-semibold text-primary">3D · Stylized</span> <span className="text-muted-foreground">— not the in-game map</span>
        </div>
      </div>
      {geo.isError ? msg("Could not load the map geometry. Connect to the internet and try again.")
        : !geo.data ? <Loading stage={stage} />
        : <Suspense fallback={msg("Preparing 3D view…")}><Leonida3D data={geo.data.data} districts={data?.districts ?? []} /></Suspense>}
      <p className="glass absolute bottom-[76px] left-3 right-3 rounded-xl border border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        Drag to pan, pinch/scroll to zoom, two fingers to tilt. Data: <a className="underline" href={SOURCE_REPO} target="_blank" rel="noreferrer">Open GTA 6 Map</a> · CC BY 4.0
      </p>
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
