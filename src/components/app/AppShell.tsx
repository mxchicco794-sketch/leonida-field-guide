import { Link, useRouterState } from "@tanstack/react-router";
import { Compass, Gem, Heart, Map, User } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/map", label: "Mappa", icon: Map },
  { to: "/", label: "Esplora", icon: Compass },
  { to: "/collectibles", label: "Collezionabili", icon: Gem },
  { to: "/favorites", label: "Preferiti", icon: Heart },
  { to: "/profile", label: "Profilo", icon: User },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col bg-background">
      <main className="flex-1 pb-24">{children}</main>
      <nav className="glass fixed inset-x-0 bottom-0 z-[1000] mx-auto max-w-md border-t border-border pb-[env(safe-area-inset-bottom)]">
        <ul className="grid grid-cols-5">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active = to === "/" ? path === "/" : path.startsWith(to);
            return (
              <li key={to}>
                <Link to={to} className={cn("relative flex flex-col items-center gap-1 py-3 text-[10px] font-semibold uppercase tracking-wider transition-colors", active ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
                  {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-primary shadow-glow" />}
                  <Icon className="size-5" strokeWidth={active ? 2.4 : 1.8} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <header className="px-5 pb-4 pt-8 animate-rise">
      <p className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-primary">{eyebrow}</p>
      <h1 className="mt-1 font-display text-3xl font-bold uppercase tracking-wide">{title}</h1>
      {children}
    </header>
  );
}

export function Attribution() {
  return (
    <p className="px-5 py-6 text-center text-[11px] leading-relaxed text-muted-foreground">
      Dati e tessere della mappa:{" "}
      <a className="underline hover:text-foreground" href="https://github.com/fbritoferreira/gta6" target="_blank" rel="noreferrer">Open GTA 6 Map</a>{" "}
      di fbritoferreira, con licenza{" "}
      <a className="underline hover:text-foreground" href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>.
      Progetto fan non ufficiale, non affiliato a Rockstar Games.
    </p>
  );
}

export function StateMessage({ title, body }: { title: string; body?: string }) {
  return (
    <div className="mx-5 rounded-2xl border border-border bg-card p-6 text-center">
      <p className="font-display text-lg font-semibold">{title}</p>
      {body && <p className="mt-1 text-sm text-muted-foreground">{body}</p>}
    </div>
  );
}
