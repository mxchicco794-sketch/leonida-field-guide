import { clusterPoints, type Cluster } from "../cluster";
import type { LeonidaLocation } from "../types";
import { LAND_H, toWorld } from "./process";

export const PIN_SIZE = 14, CLUSTER_SIZE = 36;
export const pinPosition = (loc: { x: number; y: number }) => toWorld(loc.x, loc.y, LAND_H + 0.2);

/** Perspective scale at the controls target, quantized to half zoom steps. */
export function pinZoomStep(distance: number, height: number, fov: number): number {
  const scale = height / (2 * Math.max(1, distance) * Math.tan(fov * Math.PI / 360));
  return Math.max(-1, Math.min(7, Math.floor(Math.log2(Math.max(scale, 0.01)) * 2) / 2));
}
export function clusterPins(locations: LeonidaLocation[], zoom: number, focusId?: string): Cluster<LeonidaLocation>[] {
  const focused = locations.find((loc) => loc.id === focusId);
  const out = clusterPoints(focused ? locations.filter((loc) => loc.id !== focusId) : locations, zoom);
  if (focused) out.push({ type: "single", item: focused });
  return out;
}

export interface ScreenPin<T> { x: number; y: number; radius: number; value: T }
export function tapGrid<T>(pins: ScreenPin<T>[], cell = 48) {
  const cells = new Map<string, ScreenPin<T>[]>();
  for (const pin of pins) {
    const key = `${Math.floor(pin.x / cell)},${Math.floor(pin.y / cell)}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(pin); else cells.set(key, [pin]);
  }
  return (x: number, y: number): T | undefined => {
    let nearest: ScreenPin<T> | undefined, distance = Infinity;
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const pin of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
        const d = Math.hypot(pin.x - x, pin.y - y);
        if (d <= pin.radius && d < distance) { nearest = pin; distance = d; }
      }
    }
    return nearest?.value;
  };
}

/** A gesture stays cancelled until every pointer is lifted, even if it returns to its start. */
export class TapGesture {
  private pointers = new Set<number>();
  private start = { x: 0, y: 0, time: 0 };
  private cancelled = false;
  private blockedUntil = 0;
  down(id: number, x: number, y: number, time: number, primary = true) {
    if (!this.pointers.size) { this.start = { x, y, time }; this.cancelled = !primary || time < this.blockedUntil; }
    this.pointers.add(id);
    if (this.pointers.size > 1) this.cancelled = true;
  }
  move(x: number, y: number) {
    if (Math.hypot(x - this.start.x, y - this.start.y) > 6) this.cancelled = true;
  }
  wheel(time: number) { this.cancelled = true; this.blockedUntil = time + 350; }
  cancel() { this.cancelled = true; this.pointers.clear(); }
  up(id: number, x: number, y: number, time: number, cameraChanged: boolean): boolean {
    if (!this.pointers.has(id)) return false;
    this.move(x, y);
    const tap = this.pointers.size === 1 && !this.cancelled && !cameraChanged && time - this.start.time <= 500;
    this.pointers.delete(id);
    return tap;
  }
}