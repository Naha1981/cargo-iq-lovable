import { describe, expect, it } from "vitest";
import {
  AIS_GAP_DISCLAIMER,
  DEFAULT_WEATHER_THRESHOLDS,
  assessPortConditions,
  buildAlertDraft,
  computeDedupeKey,
  correlateEventToCases,
  verificationStatusForDecision,
  withinWindow,
} from "./risk-events";

const cases = [
  {
    id: "c1",
    reference_no: "REF-001",
    port_code: "ZADUR",
    vessel_name: "MSC Example",
    container_no: "MSCU1234567",
  },
  {
    id: "c2",
    reference_no: "REF-002",
    port_code: "ZACPT",
    vessel_name: "Maersk Sample",
    container_no: null,
  },
  { id: "c3", reference_no: "REF-003", port_code: null, vessel_name: null, container_no: null },
];

describe("computeDedupeKey", () => {
  it("is stable for equivalent input", () => {
    const a = computeDedupeKey({
      source: "open_meteo",
      kind: "weather",
      observedAt: "2026-10-26T06:00:00Z",
      title: "High wind",
      portCode: "ZADUR",
    });
    const b = computeDedupeKey({
      source: "open_meteo",
      kind: "weather",
      observedAt: "2026-10-26T08:00:00+02:00",
      title: "  high   wind ",
      portCode: "zadur",
    });
    expect(a).toBe(b);
  });
  it("differs when the observed time differs", () => {
    const a = computeDedupeKey({
      source: "s",
      kind: "k",
      observedAt: "2026-10-26T06:00:00Z",
      title: "t",
    });
    const b = computeDedupeKey({
      source: "s",
      kind: "k",
      observedAt: "2026-10-26T07:00:00Z",
      title: "t",
    });
    expect(a).not.toBe(b);
  });
});

describe("correlateEventToCases", () => {
  it("matches by port for port notices at medium confidence", () => {
    const out = correlateEventToCases({ kind: "port_notice", portCode: "ZADUR" }, cases);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ caseId: "c1", matchBasis: "port", confidence: "medium" });
  });
  it("matches by vessel with containment", () => {
    const out = correlateEventToCases({ kind: "vessel", vesselName: "MSC Example" }, cases);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ caseId: "c1", matchBasis: "vessel", confidence: "medium" });
  });
  it("raises confidence to high when vessel and port both match", () => {
    const out = correlateEventToCases(
      { kind: "vessel", vesselName: "MSC Example", portCode: "ZADUR" },
      cases,
    );
    expect(out[0]).toMatchObject({ matchBasis: "vessel", confidence: "high" });
  });
  it("matches nothing when neither port nor vessel is shared", () => {
    expect(correlateEventToCases({ kind: "incident", portCode: "ZARCB" }, cases)).toHaveLength(0);
    expect(correlateEventToCases({ kind: "incident" }, cases)).toHaveLength(0);
  });
  it("never fabricates a match for a case with no routing fields", () => {
    const out = correlateEventToCases(
      { kind: "weather", portCode: "ZADUR", vesselName: "MSC Example" },
      cases,
    );
    expect(out.find((c) => c.caseId === "c3")).toBeUndefined();
  });
});

describe("assessPortConditions", () => {
  it("flags wind at the default threshold as warning", () => {
    const r = assessPortConditions({ windSpeed: 65, waveHeight: 1.2 });
    expect(r.notable).toBe(true);
    expect(r.severity).toBe("warning");
    expect(r.reasons[0]).toContain("Wind 65 km/h");
  });
  it("flags wave height as watch", () => {
    const r = assessPortConditions({ windSpeed: 10, waveHeight: 4.5 });
    expect(r.notable).toBe(true);
    expect(r.severity).toBe("watch");
  });
  it("ignores calm conditions", () => {
    expect(assessPortConditions({ windSpeed: 12, waveHeight: 0.8 }).notable).toBe(false);
    expect(assessPortConditions({ windSpeed: null, waveHeight: null }).notable).toBe(false);
  });
  it("honours owner-configured thresholds", () => {
    const r = assessPortConditions(
      { windSpeed: 45, waveHeight: null },
      { ...DEFAULT_WEATHER_THRESHOLDS, windSpeedWarnKmh: 40 },
    );
    expect(r.notable).toBe(true);
  });
});

describe("buildAlertDraft", () => {
  const event = {
    kind: "vessel" as const,
    source: "ais" as const,
    title: "Extended anchorage: MSC Example",
    summary: "Vessel at anchor 26 h outside Durban.",
    observedAt: "2026-10-26T06:00:00Z",
    sourceRef: "feed://obs/1",
  };
  const link = {
    caseId: "c1",
    matchBasis: "vessel" as const,
    rationale: "Event vessel matches case REF-001 vessel (MSC Example).",
    confidence: "medium" as const,
  };
  it("carries evidence, confidence, impact and recommended action", () => {
    const d = buildAlertDraft({ event, link, caseRef: "REF-001", severity: "warning" });
    expect(d.evidence_summary).toContain("Source: ais.");
    expect(d.evidence_summary).toContain("Observed: 2026-10-26T06:00:00Z.");
    expect(d.evidence_summary).toContain("Reference: feed://obs/1.");
    expect(d.confidence).toBe("medium");
    expect(d.recommended_action).toContain("verify");
    expect(d.likely_impact).toContain("estimate");
  });
  it("keeps status claims out of the created wording (status lives on the badge)", () => {
    const d = buildAlertDraft({ event, link, caseRef: "REF-001", severity: "watch" });
    expect(d.risk_explanation.toLowerCase()).not.toContain("unverified");
    expect(d.risk_explanation).toContain("Reported vessel signal may affect case REF-001.");
  });
  it("adds the AIS gap disclaimer for AIS gap events", () => {
    const gapEvent = {
      ...event,
      title: "AIS gap detected: MSC Example",
      summary: "No position report for 9 h.",
    };
    const d = buildAlertDraft({ event: gapEvent, link, caseRef: "REF-001", severity: "watch" });
    expect(d.risk_explanation).toContain(AIS_GAP_DISCLAIMER);
  });
  it("does not add the AIS disclaimer to non-vessel events", () => {
    const weatherEvent = { ...event, kind: "weather" as const, title: "High wind at Durban" };
    const d = buildAlertDraft({
      event: weatherEvent,
      link: { ...link, matchBasis: "port" as const },
      caseRef: "REF-001",
      severity: "warning",
    });
    expect(d.risk_explanation).not.toContain(AIS_GAP_DISCLAIMER);
  });
});

describe("verificationStatusForDecision", () => {
  it("maps decisions to statuses", () => {
    expect(verificationStatusForDecision("confirmed")).toBe("confirmed");
    expect(verificationStatusForDecision("rejected")).toBe("rejected");
    expect(verificationStatusForDecision("needs_review")).toBe("suspected");
  });
});

describe("withinWindow", () => {
  const ref = new Date("2026-10-26T12:00:00Z");
  it("keeps events inside the 24 h window", () => {
    expect(withinWindow("2026-10-26T06:00:00Z", ref, 24)).toBe(true);
  });
  it("drops events outside the window", () => {
    expect(withinWindow("2026-10-25T00:00:00Z", ref, 24)).toBe(false);
  });
  it("rejects invalid timestamps", () => {
    expect(withinWindow("not-a-date", ref, 24)).toBe(false);
  });
});
