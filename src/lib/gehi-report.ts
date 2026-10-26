// GEHI investigation report: renders a plain-text report strictly from
// recorded findings. Honesty rules: every line cites its finding's source,
// method, confidence and review status; unreviewed findings are labelled as
// such; nothing is summarised into a "fact" that the record does not support.
import { timeRelationLabel, type Confidence, type ReviewStatus, type TimeRelation } from "./gehi";

export interface ReportFinding {
  title: string;
  source: string;
  method: string;
  confidence: Confidence;
  review_status: ReviewStatus;
  review_rationale: string | null;
  observation_time: string | null;
  timeRelation?: TimeRelation;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  limitations?: string | null;
  alternatives?: string | null;
}

export interface ReportInput {
  caseRef: string;
  generatedAt: string;
  findings: ReportFinding[];
}

function findingLine(f: ReportFinding, i: number): string[] {
  const lines = [
    `${i + 1}. ${f.title}`,
    `   Review status: ${f.review_status}${f.review_status === "confirmed" ? "" : " (NOT confirmed - treat as unverified)"}`,
    `   Source: ${f.source} | Method: ${f.method} | Confidence: ${f.confidence}`,
  ];
  if (f.observation_time) {
    lines.push(
      `   Observation time: ${f.observation_time} (temporal correlation: ${timeRelationLabel(f.timeRelation ?? { kind: "unknown" })})`,
    );
  } else {
    lines.push("   Observation time: not recorded");
  }
  if (f.latitude != null && f.longitude != null) {
    lines.push(`   Position: ${f.latitude}, ${f.longitude}`);
  }
  lines.push(`   Rationale: ${f.review_rationale ?? "not recorded"}`);
  lines.push(
    `   Limitations: ${f.limitations || "not recorded"}`,
    `   Alternatives: ${f.alternatives || "not recorded"}`,
  );
  return lines;
}

export function renderInvestigationReport(input: ReportInput): string {
  const confirmed = input.findings.filter((f) => f.review_status === "confirmed");
  const unconfirmed = input.findings.filter((f) => f.review_status !== "confirmed");
  const out = [
    `GEOSPATIAL INVESTIGATION REPORT - case ${input.caseRef}`,
    `Generated at ${input.generatedAt} from ${input.findings.length} recorded finding(s).`,
    `${confirmed.length} confirmed, ${unconfirmed.length} not confirmed.`,
    "This report contains only what the underlying records state; absent fields are marked not recorded.",
    "",
  ];
  if (input.findings.length === 0) {
    out.push("No findings recorded for this case.");
    return out.join("\n");
  }
  out.push("FINDINGS");
  input.findings.forEach((f, i) => out.push(...findingLine(f, i)));
  return out.join("\n");
}
