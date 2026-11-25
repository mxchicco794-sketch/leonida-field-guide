import { useSyncExternalStore } from "react";

const KEY = "leonida:progress:v1";
export interface Progress { found: string[]; favorites: string[] }
const EMPTY: Progress = { found: [], favorites: [] };

let state: Progress = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) state = { ...EMPTY, ...(JSON.parse(raw) as Progress) };
  } catch { /* corrupted storage: start fresh */ }
}

function set(next: Progress) {
  state = next;
  localStorage.setItem(KEY, JSON.stringify(next));
  listeners.forEach((l) => l());
}

function toggle(list: "found" | "favorites", id: string) {
  load();
  const cur = state[list];
  set({ ...state, [list]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
}

export const progressActions = {
  toggleFound: (id: string) => toggle("found", id),
  toggleFavorite: (id: string) => toggle("favorites", id),
  reset: () => set(EMPTY),
  export: () => JSON.stringify(state),
};

export function useProgress(): Progress {
  return useSyncExternalStore(
    (cb) => { load(); listeners.add(cb); return () => listeners.delete(cb); },
    () => { load(); return state; },
    () => EMPTY,
  );
}
