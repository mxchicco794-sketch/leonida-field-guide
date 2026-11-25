import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { Moon, Sun } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { LocationSheet } from "@/components/app/LocationSheet";
import { useProgress } from "@/lib/leonida/progress";
import { useDataset } from "@/lib/leonida/queries";
import type { Group, LeonidaLocation } from "@/lib/leonida/types";
import { cn } from "@/lib/utils";

const LeonidaMap = lazy(() => import("@/components/app/LeonidaMap"));

export const Route = createFileRoute("/map")({
  validateSearch: (s: Record<string, unknown>): { id?: string } => (typeof s["id"] === "string" ? { id: s["id"] } : {}),
  head: () => ({
    meta: [
      { title: "Leonida Map — Leonida Companion" },
      { name: "description", content: "Interactive map of Leonida with collectibles, activities and places from the Open GTA 6 Map." },
      { property: "og:title", content: "Leonida Map — Leonida Companion" },
      { property: "og:description", content: "Interactive map of Leonida with collectibles, activities and places." },
    ],
  }),
  component: MapPage,
});

const GROUPS: Group[] = ["Collectibles", "Activities", "Crime", "Places", "Other"];
const Loading = () => <div className="grid h-full place-items-center text-sm text-muted-foreground">Loading Leonida…</div>;

function MapPage() {
  const { id } = Route.useSearch();
  const { data, kindMap, isError } = useDataset();
  const { found } = useProgress();
  const [groups, setGroups] = useState<Group[]>(["Collectibles", "Activities"]);
  const [style, setStyle] = useState<"night" | "day">("night");
  const [selected, setSelected] = useState<LeonidaLocation | null>(null);

  const visible = useMemo(
    () => (data?.locations ?? []).filter((l) => l.id === id || groups.includes(kindMap.get(l.kind)?.group ?? "Other")),
    [data, groups, kindMap, id],
  );

  return (
    <div className="fixed inset-0 mx-auto max-w-md pb-[68px]">
      <div className="absolute inset-x-0 top-0 z-[999] flex gap-2 overflow-x-auto p-3 [scrollbar-width:none]">
        <button onClick={() => setStyle(style === "night" ? "day" : "night")} aria-label="Toggle base map" className="glass shrink-0 rounded-full border border-border p-2.5">
          {style === "night" ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </button>
        {GROUPS.map((g) => {
          const on = groups.includes(g);
          return (
            <button key={g} onClick={() => setGroups(on ? groups.filter((x) => x !== g) : [...groups, g])}
              className={cn("shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition", on ? "border-primary bg-red text-primary-foreground" : "glass border-border text-muted-foreground")}>
              {g}
            </button>
          );
        })}
      </div>
      {isError && !data ? (
        <div className="grid h-full place-items-center p-8 text-center text-sm text-muted-foreground">Could not load map data. Connect to the internet once to sync it.</div>
      ) : (
        <ClientOnly fallback={<Loading />}>
          <Suspense fallback={<Loading />}>
            <LeonidaMap locations={visible} kindMap={kindMap} found={found} style={style} focusId={id} onSelect={setSelected} />
          </Suspense>
        </ClientOnly>
      )}
      {selected && <LocationSheet loc={selected} kind={kindMap.get(selected.kind)} onClose={() => setSelected(null)} />}
    </div>
  );
}
