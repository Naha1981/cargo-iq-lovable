import { describe, expect, it } from "vitest";
import { analysisStatus, candidateDateMismatches } from "./analysis-integrity";

describe("analysisStatus", () => {
  it("a failed discrepancy pass is INCOMPLETE and says absence is not a finding", () => {
    const s = analysisStatus({ discrepancyPass: "failed", discrepancyError: "FREE_GEMINI_503" });
    expect(s.status).toBe("INCOMPLETE");
    expect(s.notes[0]).toMatch(/503/);
    expect(s.notes[0]).toMatch(/does not mean/);
  });
  it("skipped pass is INCOMPLETE, ran with no issues is COMPLETE", () => {
    expect(analysisStatus({ discrepancyPass: "skipped" }).status).toBe("INCOMPLETE");
    expect(analysisStatus({ discrepancyPass: "ran" }).status).toBe("COMPLETE");
    expect(analysisStatus({ discrepancyPass: "ran", coverageWarnings: ["page 9 re-read"] }).status).toBe("INCOMPLETE");
  });
});

describe("candidateDateMismatches", () => {
  it("flags same day and month with different years on the same subject", () => {
    const c = [
      { claim_text: "The court records that the invoice originally supplied with the counterclaim was dated 13 August 2013." },
      { claim_text: "The court records that the initial invoice annexure was substituted by a third invoice dated 13 August 2012." },
    ];
    expect(candidateDateMismatches(c)).toHaveLength(1);
    expect(candidateDateMismatches(c)[0]!.explanation).toMatch(/unverified/);
  });
  it("does not flag separate payments or different days", () => {
    const c = [
      { claim_text: "Payment 1 for container BEAU6225110 charge paid $825.00 on 9 August 2022.", claim_type: "payment" },
      { claim_text: "Payment 9 for container CSNU8330251 charge paid $825.00 on 9 August 2023.", claim_type: "payment" },
      { claim_text: "The invoice was issued on 13 August 2013." },
      { claim_text: "The invoice was paid on 14 August 2012." },
    ];
    expect(candidateDateMismatches(c)).toHaveLength(0);
  });
  it("needs a shared subject so unrelated events on the same day do not match", () => {
    expect(candidateDateMismatches([{ claim_text: "The sheriff attended the yard on 1 February 2013." }, { claim_text: "Counsel argued the appeal on 1 February 2020." }])).toHaveLength(0);
  });
});
