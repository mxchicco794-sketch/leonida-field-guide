import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { loadProcessed, runWorker, WORKER_TIMEOUT_MS } from "./load";
import { CACHE_KEY, MAX_AGE_MS, type GeoCache } from "./cache";
import { processGeometry } from "./process";

const geometry = () => processGeometry({
  land: [[[[300, 300], [310, 300], [310, 310], [300, 310]]]],
  surface: { features: [] }, roads: { features: [] }, rails: { features: [] },
});

class TestWorker extends EventTarget {
  static instances: TestWorker[] = [];
  static start: ((worker: TestWorker) => void) | undefined;
  static constructionError = false;
  terminate = vi.fn();
  added: string[] = [];
  removed: string[] = [];
  constructor() {
    super();
    if (TestWorker.constructionError) throw new Error("Cannot construct worker");
    TestWorker.instances.push(this);
  }
  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    this.added.push(type); super.addEventListener(type, callback, options);
  }
  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
    this.removed.push(type); super.removeEventListener(type, callback, options);
  }
  postMessage = vi.fn(() => TestWorker.start?.(this));
  message(data: unknown) { this.dispatchEvent(new MessageEvent("message", { data })); }
}

function worker() {
  const w = TestWorker.instances[0];
  if (!w) throw new Error("Expected a Worker instance");
  return w;
}
const cache = (): GeoCache => ({ get: vi.fn(async () => null), put: vi.fn(async () => {}) });
const deferred = <T,>() => {
  let resolve: (value: T) => void = () => { throw new Error("Deferred not initialized"); };
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

beforeEach(() => {
  TestWorker.instances = []; TestWorker.start = undefined; TestWorker.constructionError = false;
  vi.stubGlobal("Worker", TestWorker);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("real worker adapter startup and cleanup", () => {
  it("registers every handler before exactly one startup message and accepts a valid response", async () => {
    const data = geometry();
    TestWorker.start = (w) => {
      expect(w.added).toEqual(["message", "error", "messageerror"]);
      w.message({ ok: true, data });
    };
    await expect(runWorker()).resolves.toBe(data);
    expect(worker().postMessage).toHaveBeenCalledExactlyOnceWith({});
    expect(worker().terminate).toHaveBeenCalledTimes(1);
    expect(worker().removed).toEqual(["message", "error", "messageerror"]);
  });

  it("clears the timer and listeners when postMessage throws synchronously", async () => {
    vi.useFakeTimers();
    TestWorker.start = () => { throw new Error("Send failed"); };
    await expect(runWorker()).rejects.toThrow("Send failed");
    expect(worker().terminate).toHaveBeenCalledTimes(1);
    expect(worker().removed).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out at 60000 milliseconds, not at 59999", async () => {
    vi.useFakeTimers();
    const task = runWorker();
    const rejection = expect(task).rejects.toThrow("Worker timed out");
    await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS - 1);
    expect(worker().terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(worker().terminate).toHaveBeenCalledTimes(1);
    expect(worker().removed).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the timeout after successful completion", async () => {
    vi.useFakeTimers();
    const task = runWorker();
    worker().message({ ok: true, data: geometry() });
    await task;
    await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS);
    expect(worker().terminate).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([null, undefined, 42, "unexpected", [], {}, { ok: "true" }, { ok: true }, { ok: true, data: null }, { ok: false, error: 42 }])(
    "rejects malformed/unexpected message %j without a pending Promise", async (data) => {
      vi.useFakeTimers();
      const task = runWorker();
      const rejection = expect(task).rejects.toBeInstanceOf(Error);
      worker().message(data);
      await rejection;
      expect(worker().terminate).toHaveBeenCalledTimes(1);
      expect(worker().removed).toHaveLength(3);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("rejects invalid processed geometry", async () => {
    const task = runWorker();
    worker().message({ ok: true, data: { ...geometry(), version: 0 } });
    await expect(task).rejects.toThrow("version mismatch");
  });

  it("rejects a reported processing failure", async () => {
    const task = runWorker();
    worker().message({ ok: false, error: "Processing failed" });
    await expect(task).rejects.toThrow("Processing failed");
  });

  it("handles runtime errors and messageerror with cleanup", async () => {
    const crashed = runWorker();
    worker().dispatchEvent(new ErrorEvent("error", { message: "Worker crashed" }));
    await expect(crashed).rejects.toThrow("Worker crashed");
    const decode = runWorker();
    const second = TestWorker.instances[1];
    if (!second) throw new Error("Second worker missing");
    second.dispatchEvent(new MessageEvent("messageerror"));
    await expect(decode).rejects.toThrow("could not be decoded");
    expect(second.terminate).toHaveBeenCalledTimes(1);
    expect(second.removed).toHaveLength(3);
  });

  it("rejects constructor failure and unavailable Worker", async () => {
    TestWorker.constructionError = true;
    await expect(runWorker()).rejects.toThrow("Cannot construct worker");
    vi.stubGlobal("Worker", undefined);
    await expect(runWorker()).rejects.toThrow("Web Workers unavailable");
  });

  it("does not construct a Worker for an already aborted signal", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(runWorker(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(TestWorker.instances).toHaveLength(0);
  });

  it("aborts pending work, clears timers and removes every listener", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const task = runWorker(controller.signal);
    controller.abort();
    await expect(task).rejects.toMatchObject({ name: "AbortError" });
    expect(worker().terminate).toHaveBeenCalledTimes(1);
    expect(worker().removed).toHaveLength(3);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    worker().message({ ok: true, data: geometry() });
    expect(worker().terminate).toHaveBeenCalledTimes(1);
  });
});

describe("loader cancellation and normal fallback", () => {
  it("loads a cold cache through the worker without fallback", async () => {
    const data = geometry(); TestWorker.start = (w) => w.message({ ok: true, data });
    const saved = cache(), main = vi.fn();
    const result = await loadProcessed({ cache: saved, main });
    expect(result.via).toBe("worker");
    expect(main).not.toHaveBeenCalled();
    expect(saved.put).toHaveBeenCalledTimes(1);
  });

  it("preserves main-thread fallback for genuine worker errors", async () => {
    TestWorker.start = (w) => w.message({ ok: false, error: "Genuine failure" });
    const main = vi.fn(async () => geometry());
    const result = await loadProcessed({ cache: cache(), main });
    expect(result.via).toBe("main-thread"); expect(result.workerError).toBe("Genuine failure");
    expect(main).toHaveBeenCalledTimes(1);
  });

  it("never falls back or writes cache when the worker is cancelled", async () => {
    const controller = new AbortController(), saved = cache(), main = vi.fn();
    const started = deferred<void>(); TestWorker.start = () => started.resolve();
    const task = loadProcessed({ cache: saved, main, signal: controller.signal });
    await started.promise; controller.abort();
    await expect(task).rejects.toMatchObject({ name: "AbortError" });
    expect(worker().terminate).toHaveBeenCalledTimes(1);
    expect(main).not.toHaveBeenCalled(); expect(saved.put).not.toHaveBeenCalled();
  });

  it("cancels a pending cache read without starting preparation", async () => {
    const controller = new AbortController(), pending = deferred<null>(), prepare = vi.fn();
    const task = loadProcessed({ cache: { get: () => pending.promise, put: vi.fn() }, worker: prepare, signal: controller.signal });
    controller.abort();
    await expect(task).rejects.toMatchObject({ name: "AbortError" });
    pending.resolve(null); await Promise.resolve();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("does not return stale offline geometry on cancellation", async () => {
    const controller = new AbortController(), data = geometry(), main = vi.fn();
    const saved: GeoCache = { get: async () => ({ key: CACHE_KEY, createdAt: 0, data }), put: vi.fn() };
    const task = loadProcessed({ cache: saved, main, now: () => MAX_AGE_MS + 1, signal: controller.signal,
      worker: async () => { controller.abort(); throw new Error("Failure concurrent with abort"); } });
    await expect(task).rejects.toMatchObject({ name: "AbortError" });
    expect(main).not.toHaveBeenCalled(); expect(saved.put).not.toHaveBeenCalled();
  });

  it("skips writes when cancelled immediately after worker completion", async () => {
    const controller = new AbortController(), saved = cache();
    const task = loadProcessed({ cache: saved, signal: controller.signal,
      worker: async () => { controller.abort(); return geometry(); }, main: vi.fn() });
    await expect(task).rejects.toMatchObject({ name: "AbortError" });
    expect(saved.put).not.toHaveBeenCalled();
  });

  it("cancels pending fallback, forwards its signal and skips writes", async () => {
    const controller = new AbortController(), saved = cache(), pending = deferred<ReturnType<typeof geometry>>();
    const started = deferred<void>();
    const main = vi.fn((signal?: AbortSignal) => { expect(signal).toBe(controller.signal); started.resolve(); return pending.promise; });
    const task = loadProcessed({ cache: saved, signal: controller.signal, worker: async () => { throw new Error("Worker unavailable"); }, main });
    await started.promise; controller.abort();
    await expect(task).rejects.toMatchObject({ name: "AbortError" });
    pending.resolve(geometry()); await Promise.resolve();
    expect(saved.put).not.toHaveBeenCalled();
  });

  it("query observer removal cancels the pending worker through the query signal", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const saved = cache(), main = vi.fn(), started = deferred<void>();
    TestWorker.start = () => started.resolve();
    const observer = new QueryObserver(client, { queryKey: ["leonida", "geo3d"],
      queryFn: ({ signal }) => loadProcessed({ cache: saved, main, signal }) });
    const unsubscribe = observer.subscribe(() => {});
    await started.promise;
    unsubscribe(); await Promise.resolve(); await Promise.resolve();
    expect(worker().terminate).toHaveBeenCalledTimes(1);
    expect(worker().removed).toHaveLength(3);
    expect(main).not.toHaveBeenCalled(); expect(saved.put).not.toHaveBeenCalled();
    client.clear();
  });
});