// Outbound adapters must (a) pass an AbortSignal so a hung endpoint cannot hold a
// request open forever, and (b) fail explicitly on timeout instead of hanging or
// returning fake data. Telemetry must stay fire-and-forget: never awaited, errors
// swallowed, product flows unaffected.
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchPortConditions } from "@/lib/adapters/weather-port-adapter";
import { querySentinelScenes } from "@/lib/adapters/satellite-adapter";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const timeoutError = () => new DOMException("The operation timed out.", "TimeoutError");

describe("weather-port-adapter timeouts", () => {
  it("passes a live AbortSignal and rejects explicitly on timeout", async () => {
    let seenSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: unknown, init?: RequestInit) => {
        seenSignal = init?.signal ?? undefined;
        return Promise.reject(timeoutError());
      }),
    );
    await expect(fetchPortConditions({})).rejects.toThrow();
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(seenSignal?.aborted).toBe(false);
  });

  it("surfaces a non-OK marine response as an explicit error, not fake data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("upstream", { status: 503 }))),
    );
    await expect(fetchPortConditions({})).rejects.toThrow("OPEN_METEO_MARINE_503");
  });
});

describe("satellite-adapter timeouts", () => {
  it("passes a live AbortSignal and rejects explicitly on timeout", async () => {
    let seenSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: unknown, init?: RequestInit) => {
        seenSignal = init?.signal ?? undefined;
        return Promise.reject(timeoutError());
      }),
    );
    await expect(
      querySentinelScenes({ bbox: [0, 0, 1, 1], start: "2026-01-01", end: "2026-01-02" }),
    ).rejects.toThrow();
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(seenSignal?.aborted).toBe(false);
  });

  it("surfaces a non-OK STAC response as an explicit error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("upstream", { status: 500 }))),
    );
    await expect(
      querySentinelScenes({ bbox: [0, 0, 1, 1], start: "2026-01-01", end: "2026-01-02" }),
    ).rejects.toThrow("COPERNICUS_STAC_500");
  });
});

describe("telemetry timeouts", () => {
  it("is fire-and-forget: returns immediately and swallows a hung endpoint", async () => {
    vi.doMock("@/lib/telemetry/config", () => ({
      getTelemetryConfig: () => ({ apiHost: "https://us.i.posthog.com", projectToken: "phc_test" }),
      getTelemetryRuntimeEnv: () => ({ mode: "test" }),
    }));
    vi.resetModules();
    const { captureTelemetry } = await import("@/lib/telemetry");
    let seenSignal: AbortSignal | undefined;
    const fetchMock = vi.fn((_input: unknown, init?: RequestInit) => {
      seenSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => {}); // never settles: hung endpoint
    });
    vi.stubGlobal("fetch", fetchMock);

    // Synchronous, non-throwing, non-awaited even though fetch never resolves.
    expect(() =>
      captureTelemetry("workflow_completed", {
        workflow: "timeout_fixture",
        duration_ms: 1,
        status: "success",
      }),
    ).not.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });
});
