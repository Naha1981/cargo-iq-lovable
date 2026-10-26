// GEHI: provenance-preserving geospatial evidence model.
// Facts vs inferences stay distinct; imagery claims only where a provider
// actually covers the date/location - absence stays explicit, never fabricated.
import { z } from "zod";

export const CONFIDENCES = ["verified", "high", "medium", "low", "unverified"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const REVIEW_STATUSES = ["draft", "under_review", "confirmed", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const findingInput = z.object({
  caseId: z.string().uuid().optional(),
  title: z.string().min(1).max(300),
  summary: z.string().max(4000).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  eventTime: z.string().datetime().optional(),
  observationTime: z.string().datetime().optional(),
  source: z.string().min(1).max(500),
  method: z.string().min(1).max(300),
  confidence: z.enum(CONFIDENCES).default("unverified"),
  rationale: z.string().max(4000).optional(),
  alternatives: z.string().max(4000).optional(),
  limitations: z.string().max(4000).optional(),
  nextAction: z.string().max(1000).optional(),
});
export type FindingInput = z.infer<typeof findingInput>;

const REVIEW_TRANSITIONS: Record<ReviewStatus, ReviewStatus[]> = {
  draft: ["under_review", "rejected"],
  under_review: ["confirmed", "rejected"],
  confirmed: [],
  rejected: ["under_review"], // a rejection can be reopened with new evidence
};

export function assertReviewTransition(from: ReviewStatus, to: ReviewStatus): void {
  if (!REVIEW_TRANSITIONS[from].includes(to)) {
    throw new Error("INVALID_REVIEW_TRANSITION: " + from + " -> " + to);
  }
}

// A finding may be marked confirmed only from under_review, and only with
// rationale recorded - the reason for confidence must exist, not just the label.
export function assertConfirmable(f: {
  review_status: ReviewStatus;
  rationale: string | null;
}): void {
  if (f.review_status !== "under_review")
    throw new Error("CONFIRM_REQUIRES_REVIEW: finding must be under review first");
  if (!f.rationale || !f.rationale.trim())
    throw new Error("CONFIRM_REQUIRES_RATIONALE: record the evidence reasoning before confirming");
}

export type TimeRelation =
  | { kind: "observation_before_event"; gapHours: number }
  | { kind: "observation_after_event"; gapHours: number }
  | { kind: "simultaneous"; gapHours: number }
  | { kind: "unknown" };

// Correlation of event time vs observation time: an observation taken AFTER an
// event cannot show the event in progress; that distinction must be visible.
export function relateTimes(eventTime?: string, observationTime?: string): TimeRelation {
  if (!eventTime || !observationTime) return { kind: "unknown" };
  const e = Date.parse(eventTime);
  const o = Date.parse(observationTime);
  if (Number.isNaN(e) || Number.isNaN(o)) return { kind: "unknown" };
  const gapHours = Math.round(Math.abs(o - e) / 3600e2) / 10;
  if (Math.abs(o - e) <= 3600e3) return { kind: "simultaneous", gapHours };
  return o < e
    ? { kind: "observation_before_event", gapHours }
    : { kind: "observation_after_event", gapHours };
}

export function timeRelationLabel(r: TimeRelation): string {
  switch (r.kind) {
    case "simultaneous":
      return "Observation within 1 hour of event - temporal proximity only, not proof of simultaneous conditions";
    case "observation_before_event":
      return (
        "Observation " +
        r.gapHours +
        "h BEFORE the event - earlier observation, not proof of conditions at event time"
      );
    case "observation_after_event":
      return (
        "Observation " +
        r.gapHours +
        "h AFTER the event - later observation, not proof of aftermath or causation"
      );
    case "unknown":
      return "Event or observation time missing - temporal correlation unknown";
  }
}

// Historical imagery honesty: a comparison exists only when both dates have
// real provider coverage. No coverage = explicit gap, never a generated image.
export interface ImageryAvailability {
  covered: boolean;
  provider?: string;
  acquisitionTime?: string;
  resolutionM?: number;
  sourceId?: string;
  licence?: string;
  limitations?: string;
}

export function comparisonAvailability(
  before: ImageryAvailability,
  after: ImageryAvailability,
): { available: boolean; reason: string } {
  if (!before.covered && !after.covered)
    return {
      available: false,
      reason: "No provider imagery for either date - comparison unavailable",
    };
  if (!before.covered)
    return {
      available: false,
      reason: "No provider imagery for the earlier date - comparison unavailable",
    };
  if (!after.covered)
    return {
      available: false,
      reason: "No provider imagery for the later date - comparison unavailable",
    };
  return { available: true, reason: "Both dates covered by provider imagery" };
}
