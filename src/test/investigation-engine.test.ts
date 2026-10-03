import { describe, expect, it } from "vitest";
import { calculateDemurrage } from "@/lib/investigation-engine";
import { sha256Hex, stableCanonical } from "@/lib/hash";

describe("CargoIQ deterministic demurrage", () => {
  it("calculates tiered demurrage without LLM arithmetic", () => {
    const result = calculateDemurrage({
      start: "2026-08-05",
      release: "2026-08-15",
      freeDays: 5,
      units: 12,
      currency: "USD",
      tieredRates: [
        { fromDay: 1, toDay: 5, dailyRate: 175 },
        { fromDay: 6, toDay: 10, dailyRate: 220 },
      ],
    });
    expect(result.elapsed).toBe(10);
    expect(result.chargeable).toBe(5);
    expect(result.total).toBe(10500);
    expect(result.dailyBreakdown).toHaveLength(5);
  });

  it("canonicalizes evidence payloads deterministically", async () => {
    const a = stableCanonical({ b: 2, a: 1, nested: { z: 3, y: 4 } });
    const b = stableCanonical({ nested: { y: 4, z: 3 }, a: 1, b: 2 });
    expect(a).toBe(b);
    expect(await sha256Hex(a)).toBe(await sha256Hex(b));
  });
});
