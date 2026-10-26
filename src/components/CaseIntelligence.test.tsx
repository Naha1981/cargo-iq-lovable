// Render-truth tests for the case Intelligence tab: timeline, alerts with
// verification actions, and cost recovery render from the timeline payload;
// empty states render honestly when nothing is linked.
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const timelinePayload = {
  links: [
    {
      id: "l1",
      tenant_id: "t1",
      event_id: "e1",
      case_id: "case-1",
      match_basis: "port",
      rationale: "Event port matches case REF-001 port (ZADUR).",
      confidence: "medium",
      created_by: null,
      created_at: "2026-10-26T07:00:00Z",
      risk_events: {
        id: "e1",
        tenant_id: "t1",
        source: "open_meteo",
        kind: "weather",
        title: "Adverse weather near ZADUR: Wind 72 km/h at or above 60 km/h threshold.",
        summary: "Wind 72 km/h",
        observed_at: "2026-10-26T06:00:00Z",
        ingested_at: "2026-10-26T06:00:05Z",
        latitude: -29.88,
        longitude: 31.02,
        port_code: "ZADUR",
        corridor: null,
        vessel_name: null,
        confidence: "medium",
        verification_status: "unverified",
        source_ref: "https://open-meteo.com/ (marine + forecast APIs)",
        dedupe_key: "k1",
        raw: null,
        created_by: null,
        created_at: "2026-10-26T06:00:05Z",
      },
    },
  ],
  alerts: [
    {
      id: "a1",
      tenant_id: "t1",
      event_id: "e1",
      case_id: "case-1",
      severity: "warning",
      headline: "Risk alert for REF-001: Adverse weather near ZADUR",
      risk_explanation: "Unverified weather signal may affect case REF-001.",
      evidence_summary: "Source: open_meteo. Observed: 2026-10-26T06:00:00Z.",
      confidence: "medium",
      likely_impact: "Possible schedule delay; impact is an estimate until verified.",
      recommended_action: "Review the linked evidence, verify the event.",
      status: "open",
      verification_status: "unverified",
      created_at: "2026-10-26T06:00:06Z",
      updated_at: "2026-10-26T06:00:06Z",
    },
  ],
  costs: [
    {
      id: "cr1",
      tenant_id: "t1",
      alert_id: "a1",
      event_id: null,
      case_id: "case-1",
      cost_category: "demurrage",
      amount: 12500,
      currency: "ZAR",
      status: "potential",
      evidence_ref: null,
      notes: null,
      created_by: null,
      created_at: "2026-10-26T06:30:00Z",
      updated_at: "2026-10-26T06:30:00Z",
    },
  ],
};

vi.mock("@/lib/risk-events.functions", () => ({
  listCaseRiskTimeline: vi.fn(async () => timelinePayload),
  capturePortWeather: vi.fn(async () => ({ captured: true })),
  ingestRiskEvent: vi.fn(async () => ({})),
  linkCostRecovery: vi.fn(async () => ({})),
  updateAlertStatus: vi.fn(async () => ({})),
  verifyRiskAlert: vi.fn(async () => ({})),
}));

import { CaseIntelligence } from "./CaseIntelligence";

describe("CaseIntelligence", () => {
  it("renders timeline, alert with evidence and actions, and cost recovery", async () => {
    render(<CaseIntelligence caseId="case-1" portCode="ZADUR" />);
    await waitFor(() => screen.getByText(/Risk alert for REF-001/));
    // alert card: severity/status/confidence/verification badges + evidence + action
    screen.getByText("warning");
    screen.getByText("confidence: medium");
    screen.getByText(/Evidence: Source: open_meteo/);
    screen.getByText(/Next: Review the linked evidence/);
    screen.getByRole("button", { name: "Confirm" });
    screen.getByRole("button", { name: "Reject" });
    screen.getByRole("button", { name: "Acknowledge" });
    // timeline row with observed time and match rationale
    screen.getByText(/Event port matches case REF-001 port/);
    // cost recovery row
    expect(screen.getAllByText("demurrage").length).toBeGreaterThan(1); // select option + linked cost row
    screen.getByText(/ZAR 12,500|ZAR 12500/);
  });

  it("honest empty states when nothing is linked", async () => {
    const fns = await import("@/lib/risk-events.functions");
    vi.mocked(fns.listCaseRiskTimeline).mockResolvedValueOnce({ links: [], alerts: [], costs: [] });
    render(<CaseIntelligence caseId="case-2" portCode={null} />);
    await waitFor(() => screen.getByText(/No alerts for this case yet/));
    screen.getByText(/No linked events yet/);
    screen.getByText(/No cost links yet/);
    // weather check disabled without a known port
    expect(screen.getByRole("button", { name: "Check port weather now" })).toBeDisabled();
  });
});
