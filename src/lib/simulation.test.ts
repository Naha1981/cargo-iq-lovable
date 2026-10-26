import { describe, expect, it } from "vitest";
import {
  caseInScope,
  compareBaselineToScenario,
  scenarioInput,
  type ScenarioInput,
} from "./simulation";

const BASE: ScenarioInput = scenarioInput.parse({
  name: "N3 closure",
  scenarioType: "road_closure",
  corridor: "Durban-Johannesburg",
  assumptions: [{ text: "N3 closed 48h at Van Reenen", source: "user" }],
});
const C = (id: string, port: string | null, corridor: string | null, vessel: string | null) => ({
  id,
  reference_no: id,
  port_code: port,
  corridor,
  vessel_name: vessel,
});
const E = (id: string, corridor: string | null, vs: string) => ({
  id,
  kind: "incident",
  port_code: null,
  corridor,
  vessel_name: null,
  verification_status: vs,
  observed_at: "2026-10-26T00:00:00Z",
});

describe("caseInScope", () => {
  it("matches on any asserted key, case-insensitive", () => {
    expect(caseInScope(C("a", null, "durban-johannesburg", null), BASE)).toBe(true);
    expect(caseInScope(C("b", null, "Cape Town corridor", null), BASE)).toBe(false);
  });
  it("no scope keys -> nothing exposed (fail closed)", () => {
    const s = scenarioInput.parse({ name: "x", scenarioType: "other" });
    expect(caseInScope(C("a", "DBN", "Durban-Johannesburg", "MV X"), s)).toBe(false);
  });
});

describe("compareBaselineToScenario", () => {
  const cases = [C("c1", null, "Durban-Johannesburg", null), C("c2", null, "Maputo", null)];
  it("reproducible exposure count + sorted ids", () => {
    const r1 = compareBaselineToScenario(BASE, cases, []);
    const r2 = compareBaselineToScenario(BASE, cases, []);
    expect(r1).toEqual(r2);
    expect(r1.shipmentsExposed).toBe(1);
    expect(r1.exposedCaseIds).toEqual(["c1"]);
  });
  it("labels insufficient data instead of inventing numbers", () => {
    const r = compareBaselineToScenario(BASE, cases, [
      E("e1", "Durban-Johannesburg", "unverified"),
    ]);
    expect(r.verifiedEvidenceCount).toBe(0);
    expect(r.unverifiedEvidenceCount).toBe(1);
    expect(r.insufficientData.join(" ")).toContain("no_independently_verified_evidence");
    expect(r.assumptionLabels).toEqual(["ASSUMPTION"]);
  });
  it("flags missing assumptions and empty scope", () => {
    const s = scenarioInput.parse({ name: "x", scenarioType: "other" });
    const r = compareBaselineToScenario(s, cases, []);
    expect(r.evidenceGaps).toContain("no_assumptions_recorded");
    expect(r.evidenceGaps.some((g) => g.startsWith("no_scope_keys"))).toBe(true);
  });
  it("measured inputs label MEASURED", () => {
    const s = scenarioInput.parse({
      name: "w",
      scenarioType: "severe_weather",
      corridor: "N3",
      assumptions: [{ text: "60mm rain observed", source: "measurement" }],
    });
    const r = compareBaselineToScenario(s, [], []);
    expect(r.assumptionLabels).toEqual(["USER-REPORTED MEASUREMENT (unverified)"]);
  });
});

describe("scenario evidence boundaries", () => {
  it("rejects inverted time window", () => {
    expect(() =>
      scenarioInput.parse({
        ...BASE,
        startsAt: "2026-10-27T00:00:00Z",
        endsAt: "2026-10-26T00:00:00Z",
      }),
    ).toThrow();
  });
  it("records only matching event IDs inside time window", () => {
    const s = scenarioInput.parse({
      ...BASE,
      startsAt: "2026-10-26T00:00:00Z",
      endsAt: "2026-10-27T00:00:00Z",
    });
    const e = {
      id: "in",
      kind: "road",
      port_code: s.portCode ?? null,
      corridor: s.corridor ?? null,
      vessel_name: null,
      verification_status: "confirmed",
      observed_at: "2026-10-26T10:00:00Z",
    };
    const r = compareBaselineToScenario(
      s,
      [],
      [e, { ...e, id: "old", observed_at: "2020-01-01T00:00:00Z" }],
    );
    expect(r.scopedEventIds).toEqual(["in"]);
    expect(r.verifiedEvidenceCount).toBe(1);
  });
});
