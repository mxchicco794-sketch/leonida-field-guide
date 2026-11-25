import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Attribution, PageHeader, StateMessage } from "@/components/app/AppShell";
import { progressActions, useProgress } from "@/lib/leonida/progress";
import { useDataset } from "@/lib/leonida/queries";
import { groupProgress } from "@/lib/leonida/stats";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/collectibles")({
  head: () => ({
    meta: [
      { title: "Collectibles Tracker — Leonida Companion" },
      { name: "description", content: "Track every GTA 6 collectible in Leonida by category and mark what you've found." },
      { property: "og:title", content: "Collectibles Tracker — Leonida Companion" },
      { property: "og:description", content: "Track every GTA 6 collectible in Leonida by category." },
    ],
  }),
  component: Collectibles,
});

function Collectibles() {
  const { data, isLoading } = useDataset();
  const { found } = useProgress();
  const [open, setOpen] = useState<string | null>(null);
  const rows = data ? groupProgress(data.locations, data.categories.kinds, "Collectibles", found) : [];

  return (
    <div>
      <PageHeader eyebrow="Tracker" title="Collectibles" />
      {isLoading && <StateMessage title="Syncing…" />}
      <ul className="space-y-2 px-5">
        {rows.map((r) => {
          const items = open === r.kind.key ? data!.locations.filter((l) => l.kind === r.kind.key) : [];
          return (
            <li key={r.kind.key} className="overflow-hidden rounded-2xl border border-border bg-card">
              <button onClick={() => setOpen(open === r.kind.key ? null : r.kind.key)} className="flex w-full items-center gap-3 p-4 text-left">
                <span className="grid size-10 place-items-center rounded-xl bg-secondary text-lg">{r.kind.icon}</span>
                <div className="flex-1">
                  <p className="font-semibold">{r.kind.name}</p>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-red" style={{ width: `${(r.found / r.total) * 100}%` }} /></div>
                </div>
                <span className="font-display text-sm text-muted-foreground">{r.found}/{r.total}</span>
              </button>
              {items.length > 0 && (
                <ul className="max-h-80 divide-y divide-border overflow-y-auto border-t border-border">
                  {items.map((l) => {
                    const isFound = found.includes(l.id);
                    return (
                      <li key={l.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                        <button aria-label="Toggle found" onClick={() => progressActions.toggleFound(l.id)} className={cn("size-5 shrink-0 rounded-md border-2", isFound ? "border-primary bg-red" : "border-muted-foreground")} />
                        <Link to="/map" search={{ id: l.id }} className={cn("flex-1 truncate", isFound && "text-muted-foreground line-through")}>{l.name}</Link>
                        <span className="text-xs text-muted-foreground">{l.area}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <Attribution />
    </div>
  );
}
