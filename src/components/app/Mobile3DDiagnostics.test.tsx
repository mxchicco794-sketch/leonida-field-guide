import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Mobile3DDiagnostics from "./Mobile3DDiagnostics";
import { SESSION_KEY } from "@/lib/leonida/geo3d/mobile-diagnostics";

const report = vi.fn(() => ({ sceneCpuBytes: 1024, gpuBufferBytes: 512, render: { calls: 14, triangles: 145270 }, camera: [0, 260, 260], target: [0, 0, 0] }));
beforeEach(() => {
  vi.useFakeTimers(); sessionStorage.clear(); report.mockClear();
  Object.assign(window, { __regionMetrics: { report } });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("keeps a closed panel idle and removes timers and visibility listeners on close", () => {
  const remove = vi.spyOn(document, "removeEventListener");
  render(<Mobile3DDiagnostics mode="legacy" />);
  expect(vi.getTimerCount()).toBe(0); expect(report).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Apri diagnostica 3D" }));
  fireEvent.click(screen.getByRole("button", { name: "REGISTRA LEGACY" }));
  expect(vi.getTimerCount()).toBe(2);
  fireEvent.click(screen.getByRole("button", { name: "Chiudi diagnostica" }));
  const reads = report.mock.calls.length;
  act(() => { vi.advanceTimersByTime(40000); });
  expect(report.mock.calls.length).toBe(reads); expect(vi.getTimerCount()).toBe(0);
  expect(remove.mock.calls.some(([event]) => event === "visibilitychange")).toBe(true); remove.mockRestore();
});
it("records only the actual mode, saves the result across mode remounts and resets it", () => {
  const view = render(<Mobile3DDiagnostics mode="legacy" />);
  fireEvent.click(screen.getByRole("button", { name: "Apri diagnostica 3D" }));
  expect(screen.getByRole("button", { name: "REGISTRA REGIONAL" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "REGISTRA LEGACY" }));
  act(() => { vi.advanceTimersByTime(34000); });
  const results = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "[]");
  expect(results).toHaveLength(1); expect(results[0].mode).toBe("legacy"); expect(results[0].durationMs).toBeGreaterThanOrEqual(30000);
  view.unmount();
  render(<Mobile3DDiagnostics mode="regional" />);
  fireEvent.click(screen.getByRole("button", { name: "Apri diagnostica 3D" }));
  expect(screen.getByRole("button", { name: "COPIA REPORT" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "RESET CONFRONTO" }));
  expect(JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "[]")).toEqual([]);
});
it("cancels the current recording if the route mode changes", () => {
  const cancel = vi.spyOn(window, "cancelAnimationFrame");
  const view = render(<Mobile3DDiagnostics mode="legacy" />);
  fireEvent.click(screen.getByRole("button", { name: "Apri diagnostica 3D" }));
  fireEvent.click(screen.getByRole("button", { name: "REGISTRA LEGACY" }));
  view.rerender(<Mobile3DDiagnostics mode="regional" />);
  expect(cancel).toHaveBeenCalledOnce();
  act(() => { vi.advanceTimersByTime(40000); });
  expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Chiudi diagnostica" }));
  expect(vi.getTimerCount()).toBe(0); cancel.mockRestore();
});
it("cancels immediately on backgrounding even if requestAnimationFrame is suspended", () => {
  const cancel = vi.spyOn(window, "cancelAnimationFrame");
  render(<Mobile3DDiagnostics mode="legacy" />);
  fireEvent.click(screen.getByRole("button", { name: "Apri diagnostica 3D" }));
  fireEvent.click(screen.getByRole("button", { name: "REGISTRA LEGACY" }));
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(cancel).toHaveBeenCalledOnce();
  expect(sessionStorage.getItem(SESSION_KEY)).toBeNull();
  hidden.mockRestore(); cancel.mockRestore();
});