import { describe, it, expect } from "vitest";
import { isSeededSampleCase } from "./sample-case";
describe("seeded sample identification", () => {
  it("labels only the exact seeded fixture", () => {
    const fixture = {
      reference_no: "DUR-2026-0412",
      vessel_name: "MV Umhlanga Trader",
      container_no: "MSKU7748213",
    };
    expect(isSeededSampleCase(fixture)).toBe(true);
    expect(isSeededSampleCase({ ...fixture, vessel_name: "A customer vessel" })).toBe(false);
    expect(isSeededSampleCase({ ...fixture, container_no: "REAL0000001" })).toBe(false);
  });
});
