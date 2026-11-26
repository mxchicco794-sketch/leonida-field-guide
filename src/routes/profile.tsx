import { createFileRoute } from "@tanstack/react-router";
import { Attribution, PageHeader } from "@/components/app/AppShell";
import { progressActions, useProgress } from "@/lib/leonida/progress";
import { useDataset } from "@/lib/leonida/queries";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profilo — Leonida Companion" },
      { name: "description", content: "I tuoi progressi sul dispositivo, lo stato della sincronizzazione e le informazioni sull'app." },
      { property: "og:title", content: "Profile — Leonida Companion" },
      { property: "og:description", content: "I tuoi progressi e lo stato della sincronizzazione." },
    ],
  }),
  component: Profile,
});

function Profile() {
  const { found, favorites } = useProgress();
  const { data } = useDataset();
  return (
    <div>
      <PageHeader eyebrow="Dispositivo" title="Profilo" />
      <div className="space-y-3 px-5">
        <Row label="Luoghi trovati" value={found.length} />
        <Row label="Preferiti" value={favorites.length} />
        <Row label="Data source" value={data ? (data.source === "cache" ? "Copia offline" : "In diretta") : "—"} />
        <Row label="Ultima sincronizzazione" value={data ? new Date(data.syncedAt).toLocaleString("it-IT") : "—"} />
        <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">Come vengono salvati i tuoi dati</p>
          <p className="mt-1">I progressi e i preferiti vengono salvati solo su questo dispositivo: al momento non è previsto un account. Dopo la prima sincronizzazione, i dati della mappa vengono memorizzati nella cache, così gli elenchi restano disponibili offline; le immagini della mappa, invece, non sono ancora disponibili senza connessione.</p>
        </div>
        <button onClick={() => { if (confirm("Vuoi azzerare tutti i luoghi trovati e i preferiti salvati su questo dispositivo?")) progressActions.reset(); }}
          className="w-full rounded-xl border border-primary/40 py-3 text-sm font-semibold text-primary">Azzera i progressi</button>
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
