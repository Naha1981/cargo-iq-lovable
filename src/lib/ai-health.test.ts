import { describe, expect, it } from "vitest";
import { composeAiHealthText, type AiHealthReport } from "./ai-health";

const base: AiHealthReport = {
  generated_at: "2026-10-25T06:00:00.000Z",
  documents_24h: {
    "EXTRACTED|REVIEW:MODEL_RAN": 5,
    "EXTRACTED_INCOMPLETE|REVIEW:MODEL_FAILED|NOTE:timeout": 2,
    "EXTRACTED_INCOMPLETE|REVIEW:MODEL_NOT_RUN": 1,
    PENDING: 3,
  },
  documents_7d: {
    "EXTRACTED|REVIEW:MODEL_RAN": 40,
    "EXTRACTED_INCOMPLETE|REVIEW:MODEL_FAILED|NOTE:timeout": 6,
  },
  app_errors_24h_total: 9,
  app_errors_24h_top_sources: [
    { source: "client", n: 6 },
    { source: "server", n: 3 },
  ],
  free_attempts_today: 7,
  latest_document_at: "2026-10-25T05:12:00.000Z",
  latest_app_error_at: "2026-10-24T22:00:00.000Z",
};

describe("composeAiHealthText", () => {
  it("aggregates extraction and review statuses by 24 h and 7 d", () => {
    const text = composeAiHealthText(base, 10);
    expect(text).toContain("Documents processed (24 h): 11 (COMPLETE 5, INCOMPLETE 3, UNKNOWN 3)");
    expect(text).toContain("Documents processed (7 d): 46");
    expect(text).toContain("Discrepancy review (24 h): ran 5, not run 1, failed 2");
  });
  it("reports cap pressure as used/limit with a percent", () => {
    expect(composeAiHealthText(base, 10)).toContain("Free daily extraction cap: 7/10 (70%)");
  });
  it("states free AI is OFF when no cap is configured", () => {
    expect(composeAiHealthText(base, null)).toContain(
      "Free daily extraction cap: not configured (free AI is OFF)",
    );
  });
  it("lists top error sources and the quiet-period caveat", () => {
    const text = composeAiHealthText(base, 10);
    expect(text).toContain("App errors (24 h): 9 total; top: client x6, server x3");
    expect(text).toContain("not an all-clear");
  });
  it("handles an empty quiet day honestly", () => {
    const text = composeAiHealthText(
      {
        ...base,
        documents_24h: {},
        documents_7d: {},
        app_errors_24h_total: 0,
        app_errors_24h_top_sources: [],
        latest_document_at: null,
      },
      10,
    );
    expect(text).toContain("Documents processed (24 h): 0 (COMPLETE 0, INCOMPLETE 0, UNKNOWN 0)");
    expect(text).toContain("top: none");
    expect(text).toContain("Latest document activity: none recorded");
  });
  it("carries counts only - no identifiers", () => {
    const text = composeAiHealthText(base, 10);
    expect(text).toContain("aggregate counts only");
    expect(text).not.toContain("timeout"); // extraction notes never leak into the report
  });
});
