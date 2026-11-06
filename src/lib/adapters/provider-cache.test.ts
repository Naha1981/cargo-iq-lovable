import { it, expect, vi } from "vitest";
import { cachedProvider } from "./provider-cache";
it("coalesces concurrent reads and reuses fresh values", async () => {
  const load = vi.fn(async () => ["scene"]);
  const [a, b] = await Promise.all([
    cachedProvider("test-coalesce", load),
    cachedProvider("test-coalesce", load),
  ]);
  expect(a).toEqual(b);
  expect(load).toHaveBeenCalledTimes(1);
  await cachedProvider("test-coalesce", load);
  expect(load).toHaveBeenCalledTimes(1);
});
it("does not retry after429 or fabricate stale output", async () => {
  const load = vi.fn(async () => {
    throw new Error("UPSTREAM_429");
  });
  await expect(cachedProvider("test-throttle", load)).rejects.toThrow("429");
  await expect(cachedProvider("test-throttle", load)).rejects.toThrow("PROVIDER_COOLDOWN");
  expect(load).toHaveBeenCalledTimes(1);
});
