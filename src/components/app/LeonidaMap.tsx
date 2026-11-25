import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import { clusterPoints } from "@/lib/leonida/cluster";
import { MAP_BOUNDS, SOURCE_REPO, TILE_URL } from "@/lib/leonida/api";
import type { District, Geometry, GeoFeature, Kind, LeonidaLocation, RouteShield } from "@/lib/leonida/types";

interface Props {
  locations: LeonidaLocation[];
  districts: District[];
  routes: RouteShield[];
  geometry?: Geometry | undefined;
  kindMap: Map<string, Kind>;
  found: string[];
  style: "night" | "day";
  focusId?: string | undefined;
  onSelect: (loc: LeonidaLocation) => void;
}

// Leaflet 1.9 bug: a canvas redraw queued before map.remove() runs after the canvas is gone (clearRect on undefined).
type CanvasInternals = { _ctx?: CanvasRenderingContext2D; _redraw: () => void };
const proto = (L.Canvas.prototype as unknown) as CanvasInternals;
const origRedraw = proto._redraw;
proto._redraw = function (this: CanvasInternals) { if (this._ctx) origRedraw.call(this); };

/** Source data uses map units (x right, y down); Leaflet CRS.Simple uses [lat, lng] = [-y, x]. */
const ll = ([x, y]: [number, number]) => [-y, x] as L.LatLngTuple;
const BOUNDS = L.latLngBounds(MAP_BOUNDS);
const ATTRIBUTION = `<a href="${SOURCE_REPO}" target="_blank" rel="noreferrer">Open GTA 6 Map</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>`;

function featureLayer(f: GeoFeature, style: L.PathOptions): L.Layer | null {
  const c = f.geometry.coordinates;
  switch (f.geometry.type) {
    case "LineString": return L.polyline((c as [number, number][]).map(ll), style);
    case "MultiLineString": return L.polyline((c as [number, number][][]).map((l) => l.map(ll)), style);
    case "Polygon": return L.polygon((c as [number, number][][]).map((r) => r.map(ll)), style);
    case "MultiPolygon": return L.polygon((c as [number, number][][][]).map((p) => p.map((r) => r.map(ll))), style);
    default: return null;
  }
}

export default function LeonidaMap({ locations, districts, routes, geometry, kindMap, found, style, focusId, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const tiles = useRef<L.TileLayer | null>(null);
  const pins = useRef<L.LayerGroup | null>(null);
  const overlay = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!el.current) return;
    // Same settings as the source map (src/map.ts): CRS.Simple, zoom -1..7, bounds padded 30%.
    const m = L.map(el.current, {
      crs: L.CRS.Simple, minZoom: -1, maxZoom: 7, zoomSnap: 0.5, zoomControl: false, preferCanvas: true, maxBounds: BOUNDS.pad(0.3),
      // Touch feel: inertia + soft bounds, animated zoom, single shared canvas renderer.
      inertia: true, inertiaDeceleration: 2600, inertiaMaxSpeed: 2200, easeLinearity: 0.2, maxBoundsViscosity: 0.6,
      zoomAnimation: true, markerZoomAnimation: true, fadeAnimation: true, wheelPxPerZoomLevel: 90, renderer: L.canvas({ padding: 0.5, tolerance: 6 }),
    });
    m.attributionControl.setPrefix(false);
    m.fitBounds(BOUNDS);
    L.control.zoom({ position: "bottomright" }).addTo(m);
    overlay.current = L.layerGroup().addTo(m);
    pins.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    tiles.current?.remove();
    tiles.current = L.tileLayer(TILE_URL(style), { tileSize: 256, minZoom: -1, minNativeZoom: 0, maxNativeZoom: 5, maxZoom: 7, noWrap: true, bounds: BOUNDS, attribution: ATTRIBUTION, keepBuffer: 3, updateWhenZooming: false, updateWhenIdle: false, crossOrigin: true }).addTo(m);
    tiles.current.bringToBack();
  }, [style]);

  // District outlines + labels and route shields from districts.json / routes.json.
  useEffect(() => {
    const m = map.current;
    if (!m || !districts.length) return;
    const g = L.layerGroup().addTo(m);
    for (const d of districts) {
      L.polygon(d.rings.map((r) => r.map(ll)), { color: "#F5EFE6", weight: 1.2, dashArray: "5 6", opacity: 0.45, fillOpacity: 0.02, interactive: false }).addTo(g);
      L.marker(ll([d.x, d.y]), { interactive: false, icon: L.divIcon({ className: "leo-label", html: `<span>${d.name}</span>`, iconSize: undefined }) }).addTo(g);
    }
    const shields = L.layerGroup();
    for (const r of routes) L.marker(ll([r.x, r.y]), { interactive: false, icon: L.divIcon({ className: `leo-shield leo-shield-${r.kind}`, html: r.ref, iconSize: undefined }) }).addTo(shields);
    const toggle = () => (m.getZoom() >= 3 ? shields.addTo(m) : shields.remove());
    m.on("zoomend", toggle); toggle();
    return () => { g.remove(); shields.remove(); m.off("zoomend", toggle); };
  }, [districts, routes]);

  // Optional vector overlay drawn from land/surface/roads/rails.json.
  useEffect(() => {
    const g = overlay.current;
    if (!g) return;
    g.clearLayers();
    if (!geometry) return;
    for (const poly of geometry.land) L.polygon(poly.map((ring) => ring.map(ll)), { color: "#e5383b", weight: 1, fill: false, interactive: false }).addTo(g);
    const roadW: Record<string, number> = { highway: 2, main: 1.4, minor: 0.8, street: 0.5 };
    for (const f of geometry.roads.features) featureLayer(f, { color: "#f4d58d", weight: roadW[f.properties["kind"] ?? ""] ?? 0.5, opacity: 0.8, interactive: false })?.addTo(g);
    for (const f of geometry.rails.features) featureLayer(f, { color: "#c0c0c0", weight: 1, dashArray: "3 3", interactive: false })?.addTo(g);
  }, [geometry]);

  // Pins: redrawn only on zoomend / data change (never per pan frame). Singles are canvas circles; clusters are few DOM labels.
  useEffect(() => {
    const g = pins.current;
    const m = map.current;
    if (!g || !m) return;
    const foundSet = new Set(found);
    let lastZoom = NaN;
    const draw = () => {
      const z = m.getZoom();
      if (z === lastZoom) return;
      lastZoom = z;
      g.clearLayers();
      for (const c of clusterPoints(locations, z)) {
        if (c.type === "single") {
          const loc = c.item;
          const colour = kindMap.get(loc.kind)?.colour ?? "#e5383b";
          const isFound = foundSet.has(loc.id);
          L.circleMarker(ll([loc.x, loc.y]), { radius: 6, weight: 2, color: "#0b0b0c", fillColor: colour, fillOpacity: isFound ? 0.25 : 0.95, opacity: isFound ? 0.4 : 1 })
            .on("click", () => onSelectRef.current(loc)).addTo(g);
        } else {
          const n = c.items.length;
          const size = n < 10 ? 30 : n < 100 ? 36 : 44;
          L.marker(ll([c.x, c.y]), { icon: L.divIcon({ className: "leo-cluster", html: `<span>${n}</span>`, iconSize: [size, size] }) })
            .on("click", () => m.flyToBounds(L.latLngBounds([ll([c.minX, c.minY]), ll([c.maxX, c.maxY])]).pad(0.3), { maxZoom: Math.min(z + 2.5, 6), duration: 0.45 }))
            .addTo(g);
        }
      }
    };
    draw();
    m.on("zoomend", draw);
    // Like the source map, first fit to where the pins are, not the whole (mostly sea) tile square.
    if (!fitted.current && locations.length && !focusId) {
      fitted.current = true;
      m.fitBounds(L.latLngBounds(locations.map((l) => ll([l.x, l.y]))).pad(0.04));
    }
    return () => { m.off("zoomend", draw); };
  }, [locations, kindMap, found, focusId]);

  useEffect(() => {
    const loc = focusId && locations.find((l) => l.id === focusId);
    if (loc && map.current) { fitted.current = true; map.current.setView(ll([loc.x, loc.y]), 5); onSelectRef.current(loc); }
  }, [focusId, locations]);

  return <div ref={el} className="h-full w-full" />;
}
