import { createFileRoute } from "@tanstack/react-router";
import { Attribution, PageHeader } from "@/components/app/AppShell";
import { progressActions, useProgress } from "@/lib/leonida/progress";
import { useDataset } from "@/lib/leonida/queries";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile — Leonida Companion" },
      { name: "description", content: "Your local progress, data sync status and app information." },
      { property: "og:title", content: "Profile — Leonida Companion" },
      { property: "og:description", content: "Your local progress and data sync status." },
    ],
  }),
  component: Profile,
});

function Profile() {
  const { found, favorites } = useProgress();
  const { data } = useDataset();
  return (
    <div>
      <PageHeader eyebrow="Device" title="Profile" />
      <div className="space-y-3 px-5">
        <Row label="Locations found" value={found.length} />
        <Row label="Favorites" value={favorites.length} />
        <Row label="Data source" value={data ? (data.source === "cache" ? "Offline copy" : "Live") : "—"} />
        <Row label="Last sync" value={data ? new Date(data.syncedAt).toLocaleString() : "—"} />
        <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">How your data is stored</p>
          <p className="mt-1">Progress and favorites are saved only on this device — no account yet. Map data is cached after the first sync, so lists work offline; map images are not yet available offline.</p>
        </div>
        <button onClick={() => { if (confirm("Reset all found and favorite markers on this device?")) progressActions.reset(); }}
          className="w-full rounded-xl border border-primary/40 py-3 text-sm font-semibold text-primary">Reset progress</button>
      </div>
      <Attribution />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-4">
      <span className="text-sm text-muted-foreground">{label}</span><span className="font-display font-semibold">{value}</span>
    </div>
  );
}
