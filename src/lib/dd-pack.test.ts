import { expect, it } from "vitest";
import { ddPackLines, isDdRow } from "./dd-pack";

const row = (track?: unknown) => ({
  id: "r1",
  title: "Carrier/terminal credit: MSCU6639870",
  status: "submitted",
  currency: "ZAR",
  calculation: {
    dd: {
      party: "carrier_terminal",
      claimAmount: 18500,
      totals: [{ classification: "disputable_with_carrier_terminal", days: 5, amount: 18500 }],
      exceptions: [{ code: "free_time_expired", message: "Free time expired on 2026-03-04" }],
      timeline: [{ date: "2026-03-01", event: "Container discharged", source: null }],
      letter: { body: "x", subject: "Credit request", readyToSend: true, blockers: [] },
      track,
    },
  },
});
it("pack text states claim, never recovery, until a confirmed outcome", () => {
  expect(isDdRow(row())).toBe(true);
  expect(isDdRow({ id: "x", calculation: {} })).toBe(false);
  const open = ddPackLines(row()).join("\n");
  expect(open).toContain("Amount claimed: ZAR 18500.00 (a claim, not a recovery)");
  expect(open).toContain("Recovered: ZAR 0.00");
  const done = ddPackLines(
    row({
      sentAt: "2026-03-10T08:00:00Z",
      channel: "email",
      recipient: "ar@x",
      events: [
        { at: "2026-03-10T08:00:00Z", kind: "sent" },
        {
          at: "2026-04-01T08:00:00Z",
          kind: "outcome",
          outcome: "partial_credit",
          amount: 12000,
          evidence: "CN-77",
        },
      ],
    }),
  ).join("\n");
  expect(done).toContain("Confirmed recovered: ZAR 12000.00");
  expect(done).toContain("evidence CN-77");
});

import { buildEvidencePackPdf } from "@/lib/pack-pdf";
import { writeFileSync } from "node:fs";
it("frozen pack PDF carries the readable D&D claim section", () => {
  const pdf = buildEvidencePackPdf({
    status: "DRAFT",
    version: 3,
    sha256_hash: "c".repeat(64),
    pack_payload: {
      case: {
        reference_no: "CIQ-DD",
        vessel_name: "MV Synthetic",
        container_no: "MSCU6639870",
        port_code: "ZADUR",
        counterparty: "Synthetic Line",
      },
      integratedFeaturesVersion: "1",
      recoveryFindings: [
        row({
          sentAt: "2026-03-10T08:00:00Z",
          channel: "email",
          recipient: "ar@x",
          events: [{ at: "2026-03-10T08:00:00Z", kind: "sent" }],
        }),
      ],
    },
  } as never);
  if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, pdf);
  const out = Buffer.from(pdf).toString("latin1");
  expect(out).toContain("Amount claimed: ZAR 18500.00");
  expect(out).toContain("Open claim. Recovered so far: ZAR 0.00");
  expect(out).not.toContain("recoveredConfirmation");
});
