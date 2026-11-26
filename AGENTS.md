<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.
<!-- LOVABLE:END -->

- Leonida data comes only from the Open GTA 6 Map (fbritoferreira.github.io/gta6, CC BY 4.0) via `src/lib/leonida/api.ts` (map settings mirror the source `src/map.ts`; heavy geometry files load only for the optional overlay); never invent locations or coordinates, and keep the attribution visible — the app is a fan companion built on that source.
- User progress (found/favorites) lives in the local store `src/lib/leonida/progress.ts`; keep all reads/writes there so a future cloud sync can replace it in one place.
- Map pin clustering, district point-in-polygon and search folding are pure TS in `src/lib/leonida/cluster.ts` (tested); pins redraw only on zoomend/data change, never per pan frame, to keep touch dragging smooth.
- 3D map geometry is preprocessed by pure TS in `src/lib/leonida/geo3d/process.ts` (run in a Web Worker, main-thread fallback in `load.ts`) and cached in IndexedDB keyed by `PROCESSOR_VERSION`; bump that constant whenever processing output changes so stale caches are discarded.
- Phase 3 pins use the 3D-only `filters.ts` adapter and pure `geo3d/pins.ts` rules; keep the 2D implementation untouched to preserve its behavior.
- `Leonida3DPins` owns two depth-independent point batches; rebuild on zoom-step/data changes and project a spatial lookup only on taps, so gestures do not trigger selection or per-frame React updates.
- Development-only `window.__pins3d.snapshot()` and `.measure()` expose live pin projections/counts and identical-camera baseline/overlay render statistics for verification; never use them as production state.
