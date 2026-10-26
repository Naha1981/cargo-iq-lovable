import { describe, expect, it } from "vitest";
import { renderInvestigationReport, type ReportFinding } from "./gehi-report";

const base: ReportFinding = {
  title: "Vessel berthed before declared arrival",
  source: "port authority advisory",
  method: "AIS cross-check",
  confidence: "medium",
  review_status: "under_review",
  review_rationale: null,
  observation_time: "2026-10-26T10:00:00Z",
  timeRelation: { kind: "observation_before_event", gapHours: 2 },
  latitude: -29.86,
  longitude: 31.02,
  created_at: "2026-10-26T11:00:00Z",
};

describe("renderInvestigationReport", () => {
  it("renders every finding with source, method, confidence and review status", () => {
    const r = renderInvestigationReport({
      caseRef: "C-1",
      generatedAt: "2026-10-26T12:00:00Z",
      findings: [base],
    });
    expect(r).toContain("case C-1");
    expect(r).toContain("port authority advisory");
    expect(r).toContain("AIS cross-check");
    expect(r).toContain("medium");
    expect(r).toContain("under_review");
  });
  it("labels unconfirmed findings as not confirmed", () => {
    const r = renderInvestigationReport({ caseRef: "C-1", generatedAt: "t", findings: [base] });
    expect(r).toContain("NOT confirmed");
  });
  it("marks absent fields as not recorded instead of fabricating", () => {
    const f = {
      ...base,
      observation_time: null,
      latitude: null,
      longitude: null,
      review_rationale: null,
    };
    const r = renderInvestigationReport({ caseRef: "C-1", generatedAt: "t", findings: [f] });
    expect(r).toContain("Observation time: not recorded");
    expect(r).toContain("Rationale: not recorded");
    expect(r).not.toContain("Position:");
  });
  it("handles the empty case honestly", () => {
    const r = renderInvestigationReport({ caseRef: "C-2", generatedAt: "t", findings: [] });
    expect(r).toContain("No findings recorded");
  });
  it("counts confirmed vs unconfirmed", () => {
    const c = {
      ...base,
      review_status: "confirmed" as const,
      review_rationale: "verified against log",
    };
    const r = renderInvestigationReport({ caseRef: "C-3", generatedAt: "t", findings: [base, c] });
    expect(r).toContain("1 confirmed, 1 not confirmed");
  });
});
