import { Check, Heart, X } from "lucide-react";
import { assetUrl } from "@/lib/leonida/api";
import { progressActions, useProgress } from "@/lib/leonida/progress";
import type { Kind, LeonidaLocation } from "@/lib/leonida/types";
import { cn } from "@/lib/utils";

export function LocationSheet({ loc, kind, onClose }: { loc: LeonidaLocation; kind?: Kind; onClose: () => void }) {
  const p = useProgress();
  const found = p.found.includes(loc.id);
  const fav = p.favorites.includes(loc.id);
  return (
    <div className="glass fixed inset-x-0 bottom-[68px] z-[1001] mx-auto max-w-md rounded-t-3xl border border-border p-5 animate-rise">
      <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-full bg-secondary p-1.5 text-muted-foreground"><X className="size-4" /></button>
      <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: kind?.colour }}>{kind?.icon} {kind?.name ?? loc.kind}</p>
      <h2 className="mt-1 pr-8 font-display text-xl font-bold">{loc.name}</h2>
      <p className="text-sm text-muted-foreground">{[loc.type, loc.area].filter(Boolean).join(" · ")}</p>
      {loc.screenshot && <img src={assetUrl(loc.screenshot)} alt={loc.name} loading="lazy" className="mt-3 aspect-video w-full rounded-xl object-cover" />}
      {loc.description && <p className="mt-3 max-h-24 overflow-y-auto text-sm leading-relaxed">{loc.description}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button onClick={() => progressActions.toggleFound(loc.id)} className={cn("flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition", found ? "bg-red text-primary-foreground shadow-glow" : "bg-secondary")}>
          <Check className="size-4" /> {found ? "Found" : "Mark found"}
        </button>
        <button onClick={() => progressActions.toggleFavorite(loc.id)} className={cn("flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition", fav ? "bg-accent text-primary" : "bg-secondary")}>
          <Heart className={cn("size-4", fav && "fill-current")} /> {fav ? "Saved" : "Favorite"}
        </button>
      </div>
    </div>
  );
}
