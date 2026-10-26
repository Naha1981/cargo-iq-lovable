// Deterministic demurrage calculator vectors.
// Provenance: rule semantics = "chargeable days = whole elapsed days minus whole
// free days; each chargeable day bills dailyRate x units at its tier".
// Where the only source is the implementation itself, the expectation is
// labelled ASSUMPTION and must be confirmed against an approved rate contract.
import { describe, expect, it } from "vitest";
import { calculateDemurrage } from "./investigation-engine";

const TIER_FLAT = [{ fromDay: 1, dailyRate: 500 }];
const TIER_STEP = [
  { fromDay: 1, toDay: 3, dailyRate: 500 },
  { fromDay: 4, dailyRate: 800 },
];

describe("calculateDemurrage", () => {
  it("V1: flat tier, whole free days, multi-unit", () => {
    const r = calculateDemurrage({
      start: "2026-01-01T00:00:00Z",
      release: "2026-01-10T00:00:00Z",
      freeDays: 3,
      units: 2,
      currency: "ZAR",
      tieredRates: TIER_FLAT,
    });
    expect(r.elapsed).toBe(9);
    expect(r.chargeable).toBe(6);
    expect(r.total).toBe(6000); // 6 days x R500 x 2 units
  });

  it("V2: tier boundary switches rate at fromDay", () => {
    const r = calculateDemurrage({
      start: "2026-01-01T00:00:00Z",
      release: "2026-01-10T00:00:00Z",
      freeDays: 3,
      units: 2,
      currency: "ZAR",
      tieredRates: TIER_STEP,
    });
    expect(r.chargeable).toBe(6);
    expect(r.total).toBe(7800); // (3x500 + 3x800) x 2
  });

  it("V3: release inside free period bills nothing", () => {
    const r = calculateDemurrage({
      start: "2026-01-01T00:00:00Z",
      release: "2026-01-03T00:00:00Z",
      freeDays: 5,
      units: 1,
      currency: "ZAR",
      tieredRates: TIER_FLAT,
    });
    expect(r.chargeable).toBe(0);
    expect(r.total).toBe(0);
    expect(r.dailyBreakdown).toEqual([]);
  });

  it("V4: release before start is rejected", () => {
    expect(() =>
      calculateDemurrage({
        start: "2026-01-10T00:00:00Z",
        release: "2026-01-01T00:00:00Z",
        freeDays: 0,
        units: 1,
        currency: "ZAR",
        tieredRates: TIER_FLAT,
      }),
    ).toThrow("RELEASE_BEFORE_START");
  });

  it("V5: partial final day is not charged (floor)", () => {
    const r = calculateDemurrage({
      start: "2026-01-01T00:00:00Z",
      release: "2026-01-10T12:00:00Z",
      freeDays: 3,
      units: 1,
      currency: "ZAR",
      tieredRates: TIER_FLAT,
    });
    expect(r.elapsed).toBe(9); // 9.5 days floors to 9
    expect(r.chargeable).toBe(6);
  });

  // ASSUMPTION (no approved contract found): freeDays is a whole-day concept,
  // so the breakdown labels and the chargeable count must use the same
  // truncation. Current code truncates for the count but labels with the raw
  // value - this test documents the inconsistency (fails today by design if
  // freeDays is fractional; passes once the rule is confirmed and aligned).
  it.fails(
    "V6 (assumption): fractional freeDays handled consistently - DOCUMENTED BUG, see comment",
    () => {
      const r = calculateDemurrage({
        start: "2026-01-01T00:00:00Z",
        release: "2026-01-08T00:00:00Z",
        freeDays: 3.7,
        units: 1,
        currency: "ZAR",
        tieredRates: TIER_FLAT,
      });
      expect(r.chargeable).toBe(4); // elapsed 7 - trunc(3.7)=3
      // labels should start at the first chargeable whole day, not 4.7:
      expect(r.dailyBreakdown[0].day).toBe(4);
    },
  );
});
