// Simulation Lab: deterministic scenario engine.
// Every number here is reproducible from the inputs. Nothing invents monetary
// losses, arrival times or confidence percentages: where the underlying record
// is missing, the metric reports "insufficient_data" and names what is needed.
import { z } from "zod";

export const SCENARIO_TYPES = [
  "flood_corridor",
  "port_congestion",
  "road_closure",
  "severe_weather",
  "border_delay",
  "facility_outage",
  "other",
] as const;
export type ScenarioType = (typeof SCENARIO_TYPES)[number];

export const SEVERITIES = ["low", "medium", "high"] as const;

export function insufficientLabel(metric: string, caseCount: number): string {
  return (
    "INSUFFICIENT DATA - " +
    metric +
    " cannot be modelled for " +
    caseCount +
    " case(s) in scope; baseline recorded but scenario impact not computable"
  );
}

export const scenarioInput = z
  .object({
    caseId: z.string().uuid().optional(),
    name: z.string().min(1).max(200),
    scenarioType: z.enum(SCENARIO_TYPES),
    areaDescription: z.string().max(2000).optional(),
    portCode: z.string().max(16).optional(),
    corridor: z.string().max(120).optional(),
    vesselName: z.string().max(200).optional(),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().optional(),
    severity: z.enum(["low", "medium", "high"]).default("medium"),
    assumptions: z
      .array(
        z.object({
          text: z.string().min(1).max(1000),
          source: z.enum(["user", "measurement"]),
        }),
      )
      .default([]),
  })
  .refine((s) => !s.startsAt || !s.endsAt || Date.parse(s.endsAt) >= Date.parse(s.startsAt), {
    message: "Scenario end must not precede start",
  });
export type ScenarioInput = z.infer<typeof scenarioInput>;

export const decisionInput = z.object({
  scenarioId: z.string().uuid(),
  decisionSummary: z.string().min(1).max(4000),
  decisionAction: z.string().max(500).optional(),
});
export type DecisionInput = z.infer<typeof decisionInput>;

export interface CaseScopeRow {
  id: string;
  reference_no: string | null;
  port_code: string | null;
  corridor: string | null;
  vessel_name: string | null;
}

export interface RiskEventScopeRow {
  id: string;
  kind: string;
  port_code: string | null;
  corridor: string | null;
  vessel_name: string | null;
  verification_status: string;
  observed_at: string;
}

/** A case is in scenario scope when it shares any asserted scope key.
 *  If the scenario asserts no scope keys, NOTHING is exposed (fail closed). */
export function caseInScope(c: CaseScopeRow, s: ScenarioInput): boolean {
  const keys: Array<[string | undefined, string | null]> = [
    [s.portCode, c.port_code],
    [s.corridor, c.corridor],
    [s.vesselName, c.vessel_name],
  ];
  return keys.some(
    ([a, b]) => a != null && a !== "" && b != null && a.toLowerCase() === b.toLowerCase(),
  );
}

export interface ComparisonResult {
  shipmentsExposed: number;
  exposedCaseIds: string[];
  verifiedEvidenceCount: number;
  unverifiedEvidenceCount: number;
  evidenceGaps: string[];
  insufficientData: string[];
  assumptionLabels: string[];
  basis: "deterministic_scope_match";
  scopedEventIds: string[];
}

export function compareBaselineToScenario(
  s: ScenarioInput,
  cases: CaseScopeRow[],
  riskEvents: RiskEventScopeRow[],
): ComparisonResult {
  const exposed = cases.filter((c) => caseInScope(c, s));
  const scopedEvents = riskEvents.filter((e) =>
    caseInScope(
      {
        id: e.id,
        reference_no: null,
        port_code: e.port_code,
        corridor: e.corridor,
        vessel_name: e.vessel_name,
      },
      s,
    ),
  );
  const timeScopedEvents = scopedEvents.filter((e) => {
    const t = Date.parse(e.observed_at);
    return (
      Number.isFinite(t) &&
      (!s.startsAt || t >= Date.parse(s.startsAt)) &&
      (!s.endsAt || t <= Date.parse(s.endsAt))
    );
  });
  const verified = timeScopedEvents.filter((e) => e.verification_status === "confirmed");
  const gaps: string[] = [];
  const insufficient: string[] = [];
  if (s.assumptions.length === 0) gaps.push("no_assumptions_recorded");
  if (timeScopedEvents.length === 0)
    insufficient.push(
      "no_risk_evidence_in_scope - collect port/corridor observations before treating the scenario as evidenced",
    );
  if (verified.length === 0 && timeScopedEvents.length > 0)
    insufficient.push(
      "no_independently_verified_evidence - all in-scope records are unverified or suspected",
    );
  if (s.portCode == null && s.corridor == null && s.vesselName == null)
    gaps.push("no_scope_keys - scenario matches nothing until a port, corridor or vessel is set");
  insufficient.push(
    "route distance, additional transit time and financial impact are not modelled: alternative route geometry, timing model and contract/rate inputs required",
  );
  return {
    shipmentsExposed: exposed.length,
    exposedCaseIds: exposed.map((c) => c.id).sort(),
    verifiedEvidenceCount: verified.length,
    unverifiedEvidenceCount: timeScopedEvents.length - verified.length,
    evidenceGaps: gaps,
    insufficientData: insufficient,
    assumptionLabels: s.assumptions.map((a) =>
      a.source === "measurement" ? "USER-REPORTED MEASUREMENT (unverified)" : "ASSUMPTION",
    ),
    basis: "deterministic_scope_match",
    scopedEventIds: timeScopedEvents.map((e) => e.id).sort(),
  };
}
