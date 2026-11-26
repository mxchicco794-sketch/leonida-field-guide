import { afterEach, expect, it, vi } from "vitest";
import { CACHE_KEY, idbCache } from "./cache";
import { processGeometry } from "./process";
import { fetchJson } from "../api";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("aborts an in-flight processed-cache transaction without committing geometry", async () => {
  const data = processGeometry({ land: [[[[300, 300], [310, 300], [310, 310], [300, 310]]]], surface: { features: [] }, roads: { features: [] }, rails: { features: [] } });
  let committed = false;
  const request = { result: undefined };
  const transaction = {
    oncomplete: null as (() => void) | null,
    onabort: null as (() => void) | null,
    onerror: null as (() => void) | null,
    error: null,
    abort: vi.fn(() => { transaction.onabort?.(); }),
    objectStore: () => ({ put: vi.fn(() => request) }),
  };
  const db = { close: vi.fn(), transaction: vi.fn(() => transaction) };
  vi.stubGlobal("indexedDB", { open: () => {
    const opening = { result: db, onsuccess: null as (() => void) | null };
    queueMicrotask(() => opening.onsuccess?.()); return opening;
  } });
  const controller = new AbortController();
  const task = idbCache.put({ key: CACHE_KEY, createdAt: 0, data }, controller.signal);
  const rejection = expect(task).rejects.toMatchObject({ name: "AbortError" });
  await vi.waitFor(() => expect(db.transaction).toHaveBeenCalledTimes(1));
  controller.abort();
  await rejection;
  // The mock's commit path is never called after an abort.
  if (!transaction.abort.mock.calls.length) { committed = true; transaction.oncomplete?.(); }
  expect(committed).toBe(false);
  expect(transaction.abort).toHaveBeenCalledTimes(1);
  expect(db.close).toHaveBeenCalledTimes(1);
});

it("does not open IndexedDB for an already cancelled write", async () => {
  const open = vi.fn(); vi.stubGlobal("indexedDB", { open });
  const data = processGeometry({ land: [[[[300, 300], [310, 300], [310, 310], [300, 310]]]], surface: { features: [] }, roads: { features: [] }, rails: { features: [] } });
  const controller = new AbortController(); controller.abort();
  await expect(idbCache.put({ key: CACHE_KEY, createdAt: 0, data }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(open).not.toHaveBeenCalled();
});

it("forwards cancellation to fallback fetch and does not use an offline cache after abort", async () => {
  const controller = new AbortController();
  const match = vi.fn(), put = vi.fn();
  vi.stubGlobal("caches", { open: async () => ({ match, put }) });
  const fetch = vi.fn((_url: string, options: RequestInit) => {
    expect(options.signal).toBe(controller.signal);
    controller.abort(); return Promise.reject(new DOMException("Aborted", "AbortError"));
  });
  vi.stubGlobal("fetch", fetch);
  await expect(fetchJson("data/land.json", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(match).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
});