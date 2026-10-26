import { describe, it, expect } from "vitest";
import { recordedImagery, compareRecordedImagery } from "./imagery-comparison";
const o = {
  id: "a",
  source: "fixture",
  observation_type: "SENTINEL_2_SCENE",
  observed_at: "2026-10-26T00:00:00Z",
  created_at: "2026-10-27T00:00:00Z",
  limitation: null,
  payload: { id: "provider", acquiredAt: "2026-10-25T00:00:00Z", bbox: [30, -30, 31, -29] },
};
describe("recorded imagery boundaries", () => {
  it("uses acquisition, never observed/ingestion fallback", () => {
    expect(recordedImagery([{ ...o, payload: {} }])[0].acquiredAt).toBeNull();
  });
  it("filters non-imagery and refuses same record", () => {
    expect(recordedImagery([{ ...o, observation_type: "AIS_POSITION" }])).toEqual([]);
    const a = recordedImagery([o])[0];
    expect(() => compareRecordedImagery(a, a)).toThrow("DISTINCT");
  });
  it("flags nonoverlap and missing rights without inventing image comparison", () => {
    const [a, b] = recordedImagery([
      o,
      { ...o, id: "b", payload: { ...o.payload, bbox: [10, 10, 11, 11] } },
    ]);
    const r = compareRecordedImagery(a, b);
    expect(r.gaps.join(" ")).toContain("do not overlap");
    expect(r.gaps.join(" ")).toContain("Licence terms not recorded");
    expect(r.gaps.join(" ")).toContain("No change or cause");
  });
});
