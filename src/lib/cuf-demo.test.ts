import { describe, it, expect } from "vitest";
import { demoRecords, findTimestampConflicts, gateDurations } from "./cuf-demo";
describe("sample demo", () => {
  it("keeps all fifteen records explicitly synthetic", () => {
    expect(demoRecords).toHaveLength(15);
    expect(demoRecords.every(r=>r.synthetic_notice === "Sample data - fictional records")).toBe(true);
  });
  it("flags one same-event timestamp conflict, not count or clock definition differences", () => {
    const conflicts=findTimestampConflicts(demoRecords);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].claimType).toBe("terminal_gate_in");
    expect(conflicts[0].records).toEqual(["Q02","C01","C02"]);
  });
  it("derives alternative intervals only from the chosen time", () => {
    expect(gateDurations("2026-10-14T18:00:00Z")).toEqual({outside:12,inside:2});
    expect(gateDurations("2026-10-14T19:00:00Z")).toEqual({outside:13,inside:1});
  });
});
