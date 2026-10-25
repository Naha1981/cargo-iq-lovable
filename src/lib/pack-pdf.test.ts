import { describe, expect, it } from "vitest";
import { buildEvidencePackPdf } from "@/lib/pack-pdf";

const pack = {
  version: 2, status: "DRAFT", sha256_hash: "a".repeat(64), generated_at: "2026-10-12T10:00:00Z", approved_by: null,
  pack_payload: {
    generatedAt: "2026-10-12T10:00:00Z",
    case: { reference_no: "CIQ-001", vessel_name: "MSC Test", container_no: "MSKU1234567", port_code: "ZADUR", counterparty: "Carrier (Pty) Ltd" },
    documents: [{ id: "d1", name: "Invoice.pdf", source_party: "Carrier", uploaded_at: "2026-10-01T08:00:00Z", sha256_hash: "b".repeat(64) }],
    timeline: [{ timestamp: "2026-10-02T08:00:00Z", title: "Container released", nature: "OBSERVED", source: "Invoice.pdf" }],
    claims: [{ id: "c1", document_id: "d1", page_number: 2, claim_text: "Released 2 Oct – “gate-out” (café)", status: "VERIFIED", nature: "REPORTED", confidence: 0.9 }],
    contradictions: [{ title: "Gate time differs", description: "Two sources", status: "RESOLVED", resolution_note: "Terminal log wins" }],
    financialCalculations: [{ calculation_type: "DEMURRAGE", currency: "ZAR", calculated_amount_minor: 1234500, charged_amount_minor: 1500000, variance_minor: 265500, rule_version: "v1", input_payload: { freeDays: 3, units: 2 } }],
    externalObservations: [],
  },
};

describe("evidence pack pdf", () => {
  it("builds a valid, deterministic PDF", () => {
    const a = buildEvidencePackPdf(pack);
    const b = buildEvidencePackPdf(pack);
    const head = String.fromCharCode(...a.slice(0, 8));
    expect(head).toBe("%PDF-1.4");
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(Buffer.from(a).toString("latin1")).toContain("%%EOF");
  });
  it("handles many claims across pages", () => {
    const many = { ...pack, pack_payload: { ...pack.pack_payload, claims: Array.from({ length: 120 }, (_, i) => ({ ...pack.pack_payload.claims[0], id: "c" + i, claim_text: "Claim " + i + " " + "word ".repeat(40) })) } };
    const out = Buffer.from(buildEvidencePackPdf(many)).toString("latin1");
    expect((out.match(/\/Type \/Page /g) ?? []).length).toBeGreaterThan(2);
  });
});

describe("status-aware title and raw imported lines", () => {
  it("titles a DRAFT pack as not approved for submission, never as a dispute submission", () => {
    const out = Buffer.from(buildEvidencePackPdf(pack)).toString("latin1");
    expect(out).toContain("Evidence Pack - DRAFT - not approved for");
    expect(out).not.toContain("Evidence Pack - Dispute Submission");
  });
  it("titles only an APPROVED pack as a dispute submission", () => {
    const out = Buffer.from(buildEvidencePackPdf({ ...pack, status: "APPROVED", approved_by: "user-123" })).toString("latin1");
    expect(out).toContain("Evidence Pack - Dispute Submission");
    expect(out).not.toContain("not approved for submission");
  });
  it("preserves raw imported lines outside the claims count and without confidence", () => {
    const withRaw = {
      ...pack,
      pack_payload: {
        ...pack.pack_payload,
        claims: [
          ...pack.pack_payload.claims,
          { id: "r1", document_id: "d1", page_number: 1, claim_text: "INVOICE HEADER FURNITURE LINE", status: "PENDING", nature: "REPORTED", claim_type: "TEXT_RECORD" },
        ],
      },
    };
    const out = Buffer.from(buildEvidencePackPdf(withRaw)).toString("latin1");
    // substantive count unaffected by the raw line (1 verified of 1, not of 2)
    expect(out).toContain("1 VERIFIED OF 1");
    // raw line preserved in its own section, not dropped
    expect(out).toContain("IMPORTED TEXT LINES");
    expect(out).toContain("INVOICE HEADER FURNITURE LINE");
    // no confidence rendered for the raw line (only the substantive claim's 90% appears)
    expect(out).not.toContain("Confidence: 55%");
  });
});

describe("map snapshots in the pack pdf", () => {
  it("lists sealed snapshots with source, dispute status and limits", () => {
    const withSnap = {
      ...pack,
      pack_payload: {
        ...pack.pack_payload,
        externalObservations: [
          { observation_type: "AIS_POSITION", observed_at: "2026-10-02T06:00:00Z", source: "AISStream", payload: {} },
          { observation_type: "MAP_SNAPSHOT", observed_at: "2026-10-02T08:00:00Z", source: "CargoIQ harbour map snapshot", latitude: -29.88, longitude: 31.04,
            payload: { vesselName: "MSC Test", mmsi: "123456789", sog: 0.2, cog: 90, inDisputedWindow: true, windowStart: "2026-10-02T00:00:00Z", windowEnd: "2026-10-06T14:20:00Z", document_id: "d1", sha256: "c".repeat(64) } },
        ],
      },
    };
    const out = Buffer.from(buildEvidencePackPdf(withSnap)).toString("latin1");
    expect(out).toContain("HARBOUR MAP SNAPSHOTS \\(1\\)");
    expect(out).toContain("INSIDE THE DISPUTED WINDOW");
    expect(out).toContain("MSC Test");
    expect(out).toContain("not independent sensor data");
    expect(out).toContain("INDEPENDENT OBSERVATIONS \\(1\\)");
  });
});

import { writeFileSync } from "node:fs";
it.skipIf(!process.env.PDF_OUT)("writes a sample", () => {
  writeFileSync(process.env.PDF_OUT!, buildEvidencePackPdf({ ...pack, status: "APPROVED", approved_by: "user-123" }));
});
