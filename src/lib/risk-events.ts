import { z } from "zod";

/** Logistics Risk Intelligence: normalized external events, case correlation,
 * alert assembly and verification rules.
 *
 * Honesty rules baked in here (from the product spec):
 * - AIS gaps and model predictions are risk signals, never confirmed facts.
 * - verification_status only becomes 'confirmed'/'rejected' via a recorded
 *   human decision (see risk-events.functions.ts verifyRiskAlert).
 * - Every alert carries its evidence summary and confidence so an operator
 *   can trace it back to the source.
 */

export const RISK_KINDS = [
  "weather",
  "vessel",
  "port_notice",
  "satellite",
  "flight",
  "incident",
  "other",
] as const;
export type RiskKind = (typeof RISK_KINDS)[number];

export const RISK_SOURCES = [
  "manual_notice",
  "open_meteo",
  "ais",
  "copernicus_stac",
  "flight_tracking",
  "public_report",
  "other",
] as const;
export type RiskSource = (typeof RISK_SOURCES)[number];

export const CONFIDENCES = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const VERIFICATION_STATUSES = ["unverified", "suspected", "confirmed", "rejected"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const ALERT_SEVERITIES = ["info", "watch", "warning", "critical"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_STATUSES = ["open", "acknowledged", "resolved", "dismissed"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const MATCH_BASES = ["port", "vessel", "corridor", "manual"] as const;
export type MatchBasis = (typeof MATCH_BASES)[number];

export const COST_CATEGORIES = [
  "demurrage",
  "detention",
  "storage",
  "missed_delivery_slot",
  "additional_transport",
  "other",
] as const;
export type CostCategory = (typeof COST_CATEGORIES)[number];

export const COST_RECOVERY_STATUSES = [
  "potential",
  "under_investigation",
  "recoverable",
  "recovered",
  "not_recoverable",
] as const;
export type CostRecoveryStatus = (typeof COST_RECOVERY_STATUSES)[number];

export const VERIFICATION_DECISIONS = ["confirmed", "rejected", "needs_review"] as const;
export type VerificationDecision = (typeof VERIFICATION_DECISIONS)[number];

export const AIS_GAP_DISCLAIMER =
  "An AIS gap is a risk signal, not proof of deliberate concealment: vessels may stop transmitting for several legitimate reasons.";

export interface RiskEventInput {
  source: RiskSource;
  kind: RiskKind;
  title: string;
  summary?: string | null;
  observedAt: string;
  latitude?: number | null;
  longitude?: number | null;
  portCode?: string | null;
  corridor?: string | null;
  vesselName?: string | null;
  confidence?: Confidence;
  sourceRef?: string | null;
  raw?: Record<string, unknown> | null;
}

export const riskEventInput = z.object({
  source: z.enum(RISK_SOURCES),
  kind: z.enum(RISK_KINDS),
  title: z.string().trim().min(3).max(300),
  summary: z.string().trim().max(4000).nullish(),
  observedAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  portCode: z.string().trim().max(12).nullish(),
  corridor: z.string().trim().max(120).nullish(),
  vesselName: z.string().trim().max(200).nullish(),
  confidence: z.enum(CONFIDENCES).default("low"),
  sourceRef: z.string().trim().max(1000).nullish(),
  raw: z.record(z.string(), z.unknown()).nullish(),
});
export type RiskEventInputParsed = z.infer<typeof riskEventInput>;

export const manualLinkInput = z.object({
  eventId: z.string().uuid(),
  caseId: z.string().uuid(),
  rationale: z.string().trim().min(3).max(1000),
});

export const verifyAlertInput = z.object({
  alertId: z.string().uuid(),
  decision: z.enum(VERIFICATION_DECISIONS),
  notes: z.string().trim().max(2000).nullish(),
});

export const alertStatusInput = z.object({
  alertId: z.string().uuid(),
  status: z.enum(ALERT_STATUSES),
});

export const costRecoveryInput = z.object({
  caseId: z.string().uuid(),
  alertId: z.string().uuid().nullish(),
  eventId: z.string().uuid().nullish(),
  costCategory: z.enum(COST_CATEGORIES),
  amount: z.number().nonnegative().nullish(),
  currency: z.string().trim().length(3).default("ZAR"),
  evidenceRef: z.string().trim().max(1000).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

export const sourceConfigInput = z.object({
  source: z.enum(RISK_SOURCES),
  enabled: z.boolean(),
  settings: z.record(z.string(), z.unknown()).default({}),
  maxEventsPerDay: z.number().int().min(1).max(10000).default(100),
});

/** Deterministic dedupe key: same source reporting the same thing at the same
 * time about the same place/vessel collapses to one event per tenant. */
export function computeDedupeKey(input: {
  source: string;
  kind: string;
  observedAt: string;
  title: string;
  portCode?: string | null;
  vesselName?: string | null;
}): string {
  const norm = (v: string | null | undefined) =>
    (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return [
    norm(input.source),
    norm(input.kind),
    new Date(input.observedAt).toISOString(),
    norm(input.title),
    norm(input.portCode),
    norm(input.vesselName),
  ].join("|");
}

export interface CorrelationCase {
  id: string;
  reference_no: string;
  port_code: string | null;
  vessel_name: string | null;
  container_no: string | null;
}

export interface CorrelationCandidate {
  caseId: string;
  matchBasis: MatchBasis;
  rationale: string;
  confidence: Confidence;
}

const normalizeVessel = (v: string | null | undefined) =>
  (v ?? "").trim().toUpperCase().replace(/\s+/g, " ");

const normalizePort = (v: string | null | undefined) =>
  (v ?? "").trim().toUpperCase().replace(/\s/g, "");

/** Match a risk event to cases by shared port and/or vessel. Port + vessel on
 * the same case raises confidence; neither matching produces no candidate.
 * Correlation never confirms anything on its own: candidates start
 * 'unverified' and need a human decision. */
export function correlateEventToCases(
  event: {
    kind: RiskKind;
    portCode?: string | null;
    vesselName?: string | null;
    corridor?: string | null;
  },
  cases: CorrelationCase[],
): CorrelationCandidate[] {
  const out: CorrelationCandidate[] = [];
  const eventPort = normalizePort(event.portCode);
  const eventVessel = normalizeVessel(event.vesselName);
  for (const c of cases) {
    const casePort = normalizePort(c.port_code);
    const caseVessel = normalizeVessel(c.vessel_name);
    const portHit = !!eventPort && !!casePort && eventPort === casePort;
    const vesselHit =
      !!eventVessel &&
      !!caseVessel &&
      (eventVessel === caseVessel ||
        eventVessel.includes(caseVessel) ||
        caseVessel.includes(eventVessel));
    if (portHit && vesselHit) {
      out.push({
        caseId: c.id,
        matchBasis: "vessel",
        rationale: `Event vessel and port both match case ${c.reference_no} (${c.vessel_name}, ${c.port_code}).`,
        confidence: "high",
      });
    } else if (vesselHit) {
      out.push({
        caseId: c.id,
        matchBasis: "vessel",
        rationale: `Event vessel matches case ${c.reference_no} vessel (${c.vessel_name}).`,
        confidence: "medium",
      });
    } else if (portHit) {
      out.push({
        caseId: c.id,
        matchBasis: "port",
        rationale: `Event port matches case ${c.reference_no} port (${c.port_code}).`,
        confidence: event.kind === "port_notice" || event.kind === "weather" ? "medium" : "low",
      });
    }
  }
  return out;
}

export interface WeatherThresholds {
  windSpeedWarnKmh: number;
  waveHeightWarnM: number;
}
export const DEFAULT_WEATHER_THRESHOLDS: WeatherThresholds = {
  windSpeedWarnKmh: 60,
  waveHeightWarnM: 4,
};

/** Decide whether measured port conditions are worth recording as a weather
 * risk event. Thresholds are owner-configurable per tenant (config, not
 * code); these are only the defaults. */
export function assessPortConditions(
  conditions: { windSpeed: number | null; waveHeight: number | null },
  thresholds: WeatherThresholds = DEFAULT_WEATHER_THRESHOLDS,
): { notable: boolean; severity: AlertSeverity; reasons: string[] } {
  const reasons: string[] = [];
  let severity: AlertSeverity = "info";
  if (conditions.windSpeed != null && conditions.windSpeed >= thresholds.windSpeedWarnKmh) {
    reasons.push(
      `Wind ${Math.round(conditions.windSpeed)} km/h at or above ${thresholds.windSpeedWarnKmh} km/h threshold.`,
    );
    severity = "warning";
  }
  if (conditions.waveHeight != null && conditions.waveHeight >= thresholds.waveHeightWarnM) {
    reasons.push(
      `Wave height ${conditions.waveHeight.toFixed(1)} m at or above ${thresholds.waveHeightWarnM} m threshold.`,
    );
    if (severity === "info") severity = "watch";
  }
  return { notable: reasons.length > 0, severity, reasons };
}

export interface AlertDraft {
  severity: AlertSeverity;
  headline: string;
  risk_explanation: string;
  evidence_summary: string;
  confidence: Confidence;
  likely_impact: string;
  recommended_action: string;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { info: 0, watch: 1, warning: 2, critical: 3 };

export function raiseSeverity(a: AlertSeverity, b: AlertSeverity): AlertSeverity {
  return SEVERITY_RANK[b] > SEVERITY_RANK[a] ? b : a;
}

/** Assemble alert text from an event + a case link. Text stays honest:
 * suspected vs confirmed is explicit, the evidence is named with its source
 * and timestamp, and AIS gaps carry the required disclaimer. */
export function buildAlertDraft(args: {
  event: {
    kind: RiskKind;
    source: RiskSource;
    title: string;
    summary?: string | null;
    observedAt: string;
    sourceRef?: string | null;
  };
  link: CorrelationCandidate;
  caseRef: string;
  severity: AlertSeverity;
}): AlertDraft {
  const { event, link, caseRef, severity } = args;
  const evidenceBits = [
    `Source: ${event.source}.`,
    `Observed: ${event.observedAt}.`,
    event.sourceRef ? `Reference: ${event.sourceRef}.` : null,
    `Match: ${link.rationale}`,
  ].filter(Boolean) as string[];
  const evidence_summary = evidenceBits.join(" ");
  const aisNote =
    event.kind === "vessel" &&
    /ais|gap|signal loss|stopped transmitting/i.test(event.title + " " + (event.summary ?? ""))
      ? " " + AIS_GAP_DISCLAIMER
      : "";
  const headline = `${severity === "critical" || severity === "warning" ? "Risk alert" : "Risk signal"} for ${caseRef}: ${event.title}`;
  const risk_explanation =
    `Unverified ${event.kind} signal may affect case ${caseRef}. ${event.summary ?? event.title}`.trim() +
    aisNote;
  const likely_impact =
    "Possible schedule delay or operational disruption for the linked shipment; impact is an estimate until verified against shipment milestones.";
  const recommended_action =
    "Review the linked evidence, verify the event against an independent source, then decide whether to update delivery commitments and notify the customer.";
  return {
    severity,
    headline,
    risk_explanation,
    evidence_summary,
    confidence: link.confidence,
    likely_impact,
    recommended_action,
  };
}

/** Map a human verification decision to the alert/event verification status. */
export function verificationStatusForDecision(decision: VerificationDecision): VerificationStatus {
  if (decision === "confirmed") return "confirmed";
  if (decision === "rejected") return "rejected";
  return "suspected";
}

/** Timeline window filter: keep events whose observed time falls within
 * +/- windowHours of the reference instant (default: last 24 h). */
export function withinWindow(observedAt: string, reference: Date, windowHours: number): boolean {
  const t = new Date(observedAt).getTime();
  if (Number.isNaN(t)) return false;
  const half = (windowHours * 3600 * 1000) / 2;
  return Math.abs(t - reference.getTime()) <= half;
}
