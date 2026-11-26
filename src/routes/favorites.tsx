import { createFileRoute, Link } from "@tanstack/react-router";
import { Heart } from "lucide-react";
import { Attribution, PageHeader, StateMessage } from "@/components/app/AppShell";
import { progressActions, useProgress } from "@/lib/leonida/progress";
import { useDataset } from "@/lib/leonida/queries";
import { kindLabel } from "@/lib/leonida/italian";

export const Route = createFileRoute("/favorites")({
  head: () => ({
    meta: [
      { title: "Preferiti — Leonida Companion" },
      { name: "description", content: "I luoghi di Leonida che hai salvato su questo dispositivo." },
      { property: "og:title", content: "Preferiti — Leonida Companion" },
      { property: "og:description", content: "I tuoi luoghi salvati a Leonida." },
    ],
  }),
  component: Favorites,
});

function Favorites() {
  const { data, kindMap } = useDataset();
  const { favorites } = useProgress();
  const items = (data?.locations ?? []).filter((l) => favorites.includes(l.id));
  return (
    <div>
      <PageHeader eyebrow="Salvati" title="Preferiti" />
      {items.length === 0 ? (
        <StateMessage title="Non hai ancora preferiti" body="Tocca un segnaposto sulla mappa e scegli «Aggiungi ai preferiti» per salvarlo qui." />
      ) : (
        <ul className="space-y-2 px-5">
          {items.map((l) => {
            const k = kindMap.get(l.kind);
            return (
              <li key={l.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 animate-rise">
                <span className="text-xl">{k?.icon}</span>
                <Link to="/map" search={{ id: l.id }} className="flex-1 min-w-0">
                  <p className="truncate font-semibold">{l.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{[kindLabel(k), l.area].filter(Boolean).join(" · ")}</p>
                </Link>
                <button aria-label="Rimuovi dai preferiti" onClick={() => progressActions.toggleFavorite(l.id)} className="text-primary"><Heart className="size-5 fill-current" /></button>
              </li>
            );
          })}
        </ul>
      )}
      <Attribution />
    </div>
  );
}
