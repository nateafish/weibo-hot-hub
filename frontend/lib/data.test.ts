// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.resetModules(); });

it("shares concurrent public-data requests and reuses them briefly across navigation", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ latest_date: "2026-11-26" })));
  vi.stubGlobal("fetch", fetch);
  const { loadManifest } = await import("./data");
  const [one, two] = await Promise.all([loadManifest(), loadManifest()]);
  expect(one).toEqual(two);
  expect(fetch).toHaveBeenCalledTimes(1);
  await loadManifest();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("refreshes expired data and never retains a failed response", async () => {
  vi.useFakeTimers();
  const fetch = vi.fn()
    .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ latest_hour: "10" })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ latest_hour: "11" })));
  vi.stubGlobal("fetch", fetch);
  const { loadManifest } = await import("./data");
  await expect(loadManifest()).rejects.toThrow("503");
  expect((await loadManifest()).latest_hour).toBe("10");
  vi.setSystemTime(Date.now() + 61_000);
  expect((await loadManifest()).latest_hour).toBe("11");
  expect(fetch).toHaveBeenCalledTimes(3);
});
