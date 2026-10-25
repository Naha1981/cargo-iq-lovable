import { describe, expect, it } from "vitest";
import { sha256Hex, stableCanonical } from "@/lib/hash";
import { buildEvidencePackPdf, type EvidencePackInput } from "@/lib/pack-pdf";

// Representative frozen payload carrying every operational register and history.
const payload = {
  generatedAt: "2026-10-15T10:00:00.000Z",
  version: 3,
  case: { id: "case-1", reference_no: "CIQ-REG-01" },
  documents: [{ id: "d1", name: "Gate log.pdf" }],
  operationalDefinitions: [
    {
      id: "od1",
      party: "Terminal",
      metric: "Moves",
      version: 1,
      acceptance: "AGREED",
      unit: "container moves",
      rule: "count moves",
      original_source_text: "orig",
      effective_from: "2026-01-01",
      effective_to: null,
      acceptance_basis: "contract",
    },
  ],
  operationalClocks: [
    {
      id: "c1",
      physical_reference: "TRUCK-01",
      kind: "GATE_IN",
      timestamp_original: "2026-10-14T18:00:00Z",
      time_zone: "UTC",
      source_party: "Terminal",
      location_basis: "gate",
    },
  ],
  appointmentAttributions: [
    {
      id: "a1",
      appointment_clock_id: "c1",
      claimant: "Transporter",
      claim_target: "Terminal",
      assertion: "delay",
      terms_reference: "clause 4",
    },
  ],
  kpiDefinitions: [
    {
      id: "k1",
      party: "Terminal",
      name: "Turnaround",
      version: 1,
      acceptance: "AGREED",
      physical_reference: "TRUCK-01",
      start_kind: "GATE_IN",
      end_kind: "GATE_OUT",
      definition: "def",
      benchmark_hours: 2,
      benchmark_basis: "agreement",
    },
  ],
  crossPartyMatches: [
    {
      id: "m1",
      event_reference: "EV-1",
      result: "CONFIRMED",
      claim_a_id: "cA",
      claim_b_id: "cB",
      rationale: "same truck",
    },
  ],
  eventIdentityReviews: [
    {
      id: "r1",
      match_id: "m1",
      version: 1,
      status: "IDENTITY_RETRACTED",
      explanation: "wrong truck",
      source_document_id: "d1",
      source_reference: "p2",
    },
  ],
  clockReconciliations: [
    {
      id: "cr1",
      physical_reference: "TRUCK-01",
      kind: "GATE_IN",
      version: 1,
      selected_clock_id: "c1",
      considered_clock_ids: ["c1", "c2"],
      explanation: "log supported",
    },
  ],
  evidenceGapHistory: [
    {
      id: "g1",
      physical_reference: "TRUCK-01",
      required_event: "WEIGH",
      version: 1,
      status: "MISSING",
      requirement_basis: "SOP",
      explanation: "not supplied",
      document_ids: ["d1"],
      evidence_reference: null,
    },
  ],
  verifiedClaims: [],
  claims: [],
  contradictions: [],
  timeline: [],
  externalObservations: [],
  financialCalculations: [],
  approvals: [],
  truthRule:
    "Public and independent observations are corroboration unless the source directly proves the event. Inference remains inference until human review.",
};

describe("frozen evidence pack hash", () => {
  it("is stable regardless of object key insertion order", async () => {
    const shuffled: Record<string, unknown> = {};
    for (const k of Object.keys(payload).reverse() as (keyof typeof payload)[])
      shuffled[k] = payload[k];
    expect(await sha256Hex(stableCanonical(shuffled))).toBe(
      await sha256Hex(stableCanonical(payload)),
    );
  });
  it("matches the pinned golden hash for the canonical payload", async () => {
    expect(await sha256Hex(stableCanonical(payload))).toBe(
      "d86e8a13d0b497e9d162f788fa44f4e350c334b670bf2055779ebc46406b2f94",
    );
  });
  it("changes when any operational register row changes", async () => {
    const altered = {
      ...payload,
      clockReconciliations: [{ ...payload.clockReconciliations[0], selected_clock_id: "c2" }],
    };
    expect(await sha256Hex(stableCanonical(altered))).not.toBe(
      await sha256Hex(stableCanonical(payload)),
    );
  });
});

describe("frozen pack pdf operational records", () => {
  const pack: EvidencePackInput = {
    version: 3,
    status: "DRAFT",
    sha256_hash: "a".repeat(64),
    generated_at: "2026-10-15T10:00:00Z",
    approved_by: null,
    pack_payload: payload,
  };
  it("renders every operational register and history section with provenance", () => {
    const out = Buffer.from(buildEvidencePackPdf(pack))
      .toString("latin1")
      .replace(/\\/g, "")
      .toLowerCase();
    for (const title of [
      "operational counting definitions (all versions)",
      "separate source clocks",
      "appointment-to-claim attribution (not liability)",
      "per-party kpi definitions (no universal benchmark)",
      "human-confirmed physical-event matches",
      "event-identity corrections (history retained)",
      "evidenced clock reconciliation decisions",
      "required evidence and gaps (not proof of non-occurrence)",
    ])
      expect(out).toContain(title);
    expect(out).toContain("considered source ids: c1, c2");
    expect(out).toContain("match m1 v1 [identity_retracted]");
  });
  it("is byte-deterministic", () => {
    expect(
      Buffer.from(buildEvidencePackPdf(pack)).equals(Buffer.from(buildEvidencePackPdf(pack))),
    ).toBe(true);
  });
});
