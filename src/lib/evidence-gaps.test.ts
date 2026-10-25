import { describe, it, expect } from "vitest";
import { gapInput, latestGaps } from "./evidence-gaps";
const good = {
  caseId: "759843cd-f9e2-441e-adf5-d13148bb46ab",
  physicalReference: "VESSEL-SYN",
  requiredEvent: "Terminal processing",
  requirementBasis: "Investigator needs processing events",
  status: "MISSING",
  explanation: "No processing data has been supplied",
  documentIds: [],
  evidenceReference: "not supplied",
  supersedesId: null,
};
describe("evidence gaps", () => {
  it("allows missing without turning it into non-occurrence", () =>
    expect(gapInput.safeParse(good).success).toBe(true));
  it("requires sources to claim received/conflicting", () => {
    expect(gapInput.safeParse({ ...good, status: "RECEIVED" }).success).toBe(false);
    expect(
      gapInput.safeParse({ ...good, status: "CONFLICTING", documentIds: [good.caseId] }).success,
    ).toBe(false);
  });
  it("selects latest state without erasing history", () => {
    const rows = [
      { physical_reference: "V", required_event: "event", version: 1, status: "EXPECTED" },
      { physical_reference: "V", required_event: "event", version: 2, status: "MISSING" },
    ];
    expect(latestGaps(rows)[0].status).toBe("MISSING");
    expect(rows.length).toBe(2);
  });
});
