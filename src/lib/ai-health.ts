/**
 * Daily AI/extraction health report (docs/AI-HEALTH-EMAIL.md): aggregate
 * counts only, no tenant/document/user identifiers. This composer is the
 * single source of the report text so the in-app owner view and any future
 * granted sender render the same content. No AI calls, no spend.
 */
import { parseExtractionStatus } from "./analysis-integrity";

export type AiHealthReport = {
  generated_at: string;
  documents_24h: Record<string, number>;
  documents_7d: Record<string, number>;
  app_errors_24h_total: number;
  app_errors_24h_top_sources: { source: string; n: number }[];
  free_attempts_today: number;
  latest_document_at: string | null;
  latest_app_error_at: string | null;
};

function sumStatuses(byStatus: Record<string, number>) {
  let complete = 0,
    incomplete = 0,
    unknown = 0,
    reviewRan = 0,
    reviewFailed = 0,
    reviewNotRun = 0,
    total = 0;
  for (const [status, n] of Object.entries(byStatus)) {
    const parsed = parseExtractionStatus(status);
    total += n;
    if (parsed.extraction === "COMPLETE") complete += n;
    else if (parsed.extraction === "INCOMPLETE") incomplete += n;
    else unknown += n;
    if (parsed.review === "MODEL_RAN") reviewRan += n;
    else if (parsed.review === "MODEL_FAILED") reviewFailed += n;
    else if (parsed.review === "MODEL_NOT_RUN") reviewNotRun += n;
  }
  return { total, complete, incomplete, unknown, reviewRan, reviewFailed, reviewNotRun };
}

/** Exact text of the owner health report; safe to forward, counts only. */
export function composeAiHealthText(report: AiHealthReport, dailyCap: number | null): string {
  const d = sumStatuses(report.documents_24h);
  const w = sumStatuses(report.documents_7d);
  const capLine =
    dailyCap == null
      ? "Free daily extraction cap: not configured (free AI is OFF)"
      : "Free daily extraction cap: " +
        report.free_attempts_today +
        "/" +
        dailyCap +
        " (" +
        (dailyCap > 0 ? Math.round((report.free_attempts_today / dailyCap) * 100) : 0) +
        "%)";
  const top = report.app_errors_24h_top_sources.length
    ? report.app_errors_24h_top_sources.map((s) => s.source + " x" + s.n).join(", ")
    : "none";
  const date = report.generated_at.slice(0, 10);
  return [
    "CargoIQ extraction health for " + date + " (UTC):",
    "- Documents processed (24 h): " +
      d.total +
      " (COMPLETE " +
      d.complete +
      ", INCOMPLETE " +
      d.incomplete +
      ", UNKNOWN " +
      d.unknown +
      ")",
    "- Documents processed (7 d): " + w.total,
    "- Discrepancy review (24 h): ran " +
      d.reviewRan +
      ", not run " +
      d.reviewNotRun +
      ", failed " +
      d.reviewFailed,
    "- " + capLine,
    "- App errors (24 h): " + report.app_errors_24h_total + " total; top: " + top,
    "- Latest document activity: " + (report.latest_document_at ?? "none recorded"),
    "- Quiet period note: if counts are zero, nothing was attempted - that is not an all-clear.",
    "This report contains aggregate counts only: no tenant data, no document names, no user identifiers.",
  ].join("\n");
}
