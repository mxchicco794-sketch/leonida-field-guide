import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import { SOURCE_REPO, TILE_URL } from "@/lib/leonida/api";
import type { Kind, LeonidaLocation } from "@/lib/leonida/types";

interface Props {
  locations: LeonidaLocation[];
  kindMap: Map<string, Kind>;
  found: string[];
  style: "night" | "day";
  focusId?: string;
  onSelect: (loc: LeonidaLocation) => void;
}

export default function LeonidaMap({ locations, kindMap, found, style, focusId, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { crs: L.CRS.Simple, minZoom: 0, maxZoom: 7, zoomControl: false, preferCanvas: true, attributionControl: true });
    m.attributionControl.setPrefix(false);
    m.setView([-500, 500], 1);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    tiles.current?.remove();
    tiles.current = L.tileLayer(TILE_URL(style), {
      tileSize: 256, maxNativeZoom: 5, maxZoom: 7, noWrap: true,
      attribution: `<a href="${SOURCE_REPO}" target="_blank" rel="noreferrer">Open GTA 6 Map</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>`,
    }).addTo(m);
  }, [style]);

  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    const foundSet = new Set(found);
    for (const loc of locations) {
      const colour = kindMap.get(loc.kind)?.colour ?? "#e5383b";
      const isFound = foundSet.has(loc.id);
      L.circleMarker([-loc.y, loc.x], {
        radius: 6, weight: 2, color: "#0b0b0c", fillColor: colour, fillOpacity: isFound ? 0.25 : 0.95, opacity: isFound ? 0.4 : 1,
      }).on("click", () => onSelectRef.current(loc)).addTo(g);
    }
  }, [locations, kindMap, found]);

  useEffect(() => {
    const loc = focusId && locations.find((l) => l.id === focusId);
    if (loc && map.current) { map.current.setView([-loc.y, loc.x], 5); onSelectRef.current(loc); }
  }, [focusId, locations]);

  return <div ref={el} className="h-full w-full" />;
}
