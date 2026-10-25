// Provider-neutral integrity helpers. Rule-derived candidates are NOT verified findings.
export type ClaimLite = {
  claim_text: string;
  page_number?: number | null;
  claim_type?: string | null;
};

export type ReviewCoverage = "MODEL_RAN" | "MODEL_FAILED" | "MODEL_NOT_RUN";
export type AnalysisStatus = {
  extraction: "COMPLETE" | "INCOMPLETE";
  review: ReviewCoverage;
  extractionNotes: string[];
  reviewNote: string;
};

/**
 * Two separate questions. Extraction completeness: did we read the whole document without a failed, truncated or
 * partial provider call? Discrepancy-review coverage: did the OPTIONAL model discrepancy check run? A missing
 * optional check never makes a complete extraction incomplete, and a failed check never reads as a clean none.
 */
export function analysisStatus(o: {
  discrepancyPass: "ran" | "failed" | "skipped";
  discrepancyError?: string;
  fallbackErrors?: string[];
  coverageWarnings?: string[];
}): AnalysisStatus {
  const extractionNotes: string[] = [];
  for (const e of o.fallbackErrors ?? [])
    if (!/^discrepancy pass/.test(e)) extractionNotes.push("Provider issue: " + e);
  for (const w of o.coverageWarnings ?? []) extractionNotes.push("Coverage: " + w);
  const review: ReviewCoverage =
    o.discrepancyPass === "ran"
      ? "MODEL_RAN"
      : o.discrepancyPass === "failed"
        ? "MODEL_FAILED"
        : "MODEL_NOT_RUN";
  const reviewNote =
    review === "MODEL_RAN"
      ? "Optional model discrepancy check ran. Its flags are candidates for human review, not findings."
      : review === "MODEL_FAILED"
        ? "Optional model discrepancy check FAILED (" +
          (o.discrepancyError ?? "error") +
          "). No flags does not mean no discrepancies exist."
        : "Optional model discrepancy check was not run for this provider. Only rule-based candidate flags were applied.";
  return {
    extraction: extractionNotes.length ? "INCOMPLETE" : "COMPLETE",
    review,
    extractionNotes,
    reviewNote,
  };
}

/** Stored in documents.extraction_status (already part of the canonical pack payload via the documents rows). */
export function encodeExtractionStatus(s: AnalysisStatus): string {
  return (
    (s.extraction === "COMPLETE" ? "EXTRACTED" : "EXTRACTED_INCOMPLETE") +
    "|REVIEW:" +
    s.review +
    (s.extractionNotes.length
      ? "|NOTE:" + s.extractionNotes.join(" ; ").replace(/\|/g, "/").slice(0, 600)
      : "")
  );
}
export function parseExtractionStatus(v: unknown): {
  extraction: "COMPLETE" | "INCOMPLETE" | "UNKNOWN";
  review: ReviewCoverage | "UNKNOWN";
  note: string;
} {
  const t = String(v ?? "");
  const extraction = t.startsWith("EXTRACTED_INCOMPLETE")
    ? "INCOMPLETE"
    : t.startsWith("EXTRACTED")
      ? "COMPLETE"
      : "UNKNOWN";
  const review =
    (/\|REVIEW:(MODEL_RAN|MODEL_FAILED|MODEL_NOT_RUN)/.exec(t)?.[1] as
      ReviewCoverage | undefined) ?? "UNKNOWN";
  return { extraction, review, note: /\|NOTE:(.*)$/.exec(t)?.[1] ?? "" };
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const DM_Y = new RegExp("\\b(\\d{1,2})\\s+(" + MONTHS.join("|") + ")\\s+(\\d{4})\\b", "gi");
const IDLIKE = /\b[A-Z]{4}\s?\d{6,7}\b|\b\d{8,}\b/g;
const STOP = new Set([
  "the",
  "a",
  "an",
  "of",
  "to",
  "and",
  "in",
  "on",
  "at",
  "for",
  "by",
  "that",
  "was",
  "were",
  "is",
  "it",
  "its",
  "with",
  "as",
  "dated",
  "date",
  "court",
  "noted",
  "stated",
  "states",
  "records",
  "record",
  "judgment",
  "document",
]);
const LEDGER = /payment|paid|charge|fee|receipt|tariff/i;

function dayMonthYears(t: string) {
  const out: { dm: string; y: string }[] = [];
  for (const m of t.matchAll(DM_Y))
    out.push({ dm: Number(m[1]) + " " + m[2]!.toLowerCase(), y: m[3]! });
  return out;
}
function words(t: string) {
  return new Set(
    t
      .toLowerCase()
      .replace(DM_Y, " ")
      .match(/[a-z]{4,}/g)
      ?.filter((w) => !STOP.has(w)) ?? [],
  );
}

/**
 * Candidate only: two claims give the same day and month with different years AND share at least one subject word
 * (e.g. "invoice"). Skipped for ledger lines (different payments legitimately have different dates) and when
 * both claims carry different record IDs. A human must verify each candidate against the source passage.
 */
export function candidateDateMismatches(
  claims: ClaimLite[],
): { a: number; b: number; explanation: string }[] {
  const out: { a: number; b: number; explanation: string }[] = [];
  const meta = claims.map((c) => ({
    d: dayMonthYears(c.claim_text),
    w: words(c.claim_text),
    ids: new Set((c.claim_text.match(IDLIKE) ?? []).map((x) => x.replace(/\s/g, ""))),
    ledger: LEDGER.test(c.claim_text) || LEDGER.test(c.claim_type ?? ""),
  }));
  // Words that appear in many claims (party names, "container") do not identify one subject.
  const df = new Map<string, number>();
  for (const m of meta) for (const w of m.w) df.set(w, (df.get(w) ?? 0) + 1);
  const common = (w: string) =>
    claims.length >= 8 && (df.get(w) ?? 0) > Math.max(4, claims.length * 0.12);
  for (let i = 0; i < claims.length; i++)
    for (let j = i + 1; j < claims.length; j++) {
      const A = meta[i]!,
        B = meta[j]!;
      if (!A.d.length || !B.d.length || (A.ledger && B.ledger)) continue;
      if (A.ids.size && B.ids.size && ![...A.ids].some((x) => B.ids.has(x))) continue;
      const shared = [...A.w].filter((w) => B.w.has(w) && !common(w));
      if (shared.length < 1) continue;
      for (const x of A.d)
        for (const y of B.d) {
          if (x.dm === y.dm && x.y !== y.y) {
            out.push({
              a: i + 1,
              b: j + 1,
              explanation:
                "Rule-based candidate, unverified: the same day and month (" +
                x.dm +
                ") appears with different years (" +
                x.y +
                " vs " +
                y.y +
                ") in claims sharing the subject word(s): " +
                shared.slice(0, 4).join(", ") +
                ".",
            });
          }
        }
    }
  return out;
}
