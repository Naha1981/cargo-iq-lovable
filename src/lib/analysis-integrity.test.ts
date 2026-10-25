import { describe, expect, it } from "vitest";
import { extractChunked, type ClaimDraft } from "./extraction.functions";
import {
  analysisStatus,
  candidateDateMismatches,
  encodeExtractionStatus,
  parseExtractionStatus,
} from "./analysis-integrity";

describe("analysisStatus", () => {
  it("a failed optional pass does not make a complete extraction incomplete, and is not a clean none", () => {
    const s = analysisStatus({ discrepancyPass: "failed", discrepancyError: "FREE_GEMINI_503" });
    expect(s.extraction).toBe("COMPLETE");
    expect(s.review).toBe("MODEL_FAILED");
    expect(s.reviewNote).toMatch(/does not mean/);
  });
  it("provider or coverage failures make extraction INCOMPLETE", () => {
    expect(
      analysisStatus({ discrepancyPass: "ran", coverageWarnings: ["page 9 not read"] }).extraction,
    ).toBe("INCOMPLETE");
    expect(
      analysisStatus({ discrepancyPass: "skipped", fallbackErrors: ["chunk 2 failed"] }).extraction,
    ).toBe("INCOMPLETE");
    expect(analysisStatus({ discrepancyPass: "skipped" }).extraction).toBe("COMPLETE");
  });
  it("encodes and parses the stored status", () => {
    const e = encodeExtractionStatus(
      analysisStatus({
        discrepancyPass: "failed",
        discrepancyError: "x",
        coverageWarnings: ["p9 | gap"],
      }),
    );
    expect(parseExtractionStatus(e)).toMatchObject({
      extraction: "INCOMPLETE",
      review: "MODEL_FAILED",
    });
    expect(parseExtractionStatus("PENDING").extraction).toBe("UNKNOWN");
  });
});

describe("candidateDateMismatches", () => {
  it("flags same day and month with different years on the same subject", () => {
    const c = [
      {
        claim_text:
          "The court records that the invoice originally supplied with the counterclaim was dated 13 August 2013.",
      },
      {
        claim_text:
          "The court records that the initial invoice annexure was substituted by a third invoice dated 13 August 2012.",
      },
    ];
    expect(candidateDateMismatches(c)).toHaveLength(1);
    expect(candidateDateMismatches(c)[0]!.explanation).toMatch(/unverified/);
  });
  it("does not flag separate payments or different days", () => {
    const c = [
      {
        claim_text: "Payment 1 for container BEAU6225110 charge paid $825.00 on 9 August 2022.",
        claim_type: "payment",
      },
      {
        claim_text: "Payment 9 for container CSNU8330251 charge paid $825.00 on 9 August 2023.",
        claim_type: "payment",
      },
      { claim_text: "The invoice was issued on 13 August 2013." },
      { claim_text: "The invoice was paid on 14 August 2012." },
    ];
    expect(candidateDateMismatches(c)).toHaveLength(0);
  });
  it("needs a shared subject so unrelated events on the same day do not match", () => {
    expect(
      candidateDateMismatches([
        { claim_text: "The sheriff attended the yard on 1 February 2013." },
        { claim_text: "Counsel argued the appeal on 1 February 2020." },
      ]),
    ).toHaveLength(0);
  });
});

describe("extractChunked (provider-neutral)", () => {
  const pages = Array.from(
    { length: 6 },
    (_, i) => ("page " + (i + 1) + " ").repeat(1) + "x".repeat(7000),
  );
  const claim = (t: string): ClaimDraft => ({
    page_number: 1,
    claim_text: t,
    nature: "REPORTED",
    evidence_class: "DOCUMENT",
    confidence: 0.9,
  });
  it("keeps good sections, retries once, and reports the failed pages instead of dropping them silently", async () => {
    const seen: string[] = [];
    let calls = 0;
    const warnings: string[] = [];
    const out = await extractChunked(
      async (b, mime) => {
        calls++;
        const t = new TextDecoder().decode(b);
        seen.push(t);
        if (t.includes("section 2 of")) throw new Error("FREE_503");
        expect(mime).toBe("text/plain");
        return [claim("claim " + calls)];
      },
      pages,
      "f.pdf",
      warnings,
    );
    expect(out.length).toBeGreaterThan(0);
    expect(warnings.some((w) => /section 2\/\d+ \(pages \d+-\d+\) failed: FREE_503/.test(w))).toBe(
      true,
    );
    expect(seen.filter((t) => t.includes("section 2 of")).length).toBe(2);
    expect(seen[0]).toContain("[page 1]");
  });
  it("throws when no section succeeded", async () => {
    await expect(
      extractChunked(
        async () => {
          throw new Error("down");
        },
        pages,
        "f.pdf",
        [],
      ),
    ).rejects.toThrow(/NO_SECTION_SUCCEEDED/);
  });
});
