import { z } from "zod";
import {
  countMetrics,
  latestCountVersions,
  reconcileCounts,
  countProductivity,
  type CountRecord,
  type CountRule,
} from "./count-ledger";
import { evaluateKpi } from "./kpi-definitions";
import { reconciledClockGroup } from "./operational-clocks";
export const countComparisonInput = z
  .object({
    caseId: z.string().uuid(),
    name: z.string().trim().min(3).max(200),
    metric: z.enum(countMetrics),
    outputUnit: z.string().trim().min(1).max(100),
    ruleIds: z.array(z.string().uuid()).min(1).max(20),
    physicalReferences: z.array(z.string().trim().min(3).max(200)).min(1).max(500),
    kpiDefinitionId: z.string().uuid().nullable(),
    acceptance: z.enum(["UNRESOLVED", "PARTY_REPORTED", "AGREED", "CONTRACTUALLY_SPECIFIED"]),
    rationale: z.string().trim().min(20).max(4000),
    sourceDocumentId: z.string().uuid(),
    sourceReference: z.string().trim().min(3).max(1000),
    supersedesId: z.string().uuid().nullable(),
  })
  .superRefine((r, c) => {
    for (const key of ["ruleIds", "physicalReferences"] as const)
      if (new Set(r[key]).size !== r[key].length)
        c.addIssue({ code: "custom", path: [key], message: "Duplicate entries are not allowed" });
  });
export type CountComparison = z.infer<typeof countComparisonInput> & {
  id: string;
  version: number;
};
export function evaluateCountComparison(
  def: CountComparison,
  records: CountRecord[],
  allRules: CountRule[],
  kpis: any[] = [],
  clocks: any[] = [],
  decisions: any[] = [],
) {
  const rules = allRules.filter((r) => def.ruleIds.includes(r.id)),
    currentIds = new Set(latestCountVersions(allRules).map((r) => r.id));
  const issues: string[] = [];
  if (!["AGREED", "CONTRACTUALLY_SPECIFIED"].includes(def.acceptance))
    issues.push("Common scope and mapping are not agreed or contractually specified");
  if (rules.length !== def.ruleIds.length || rules.some((r) => !currentIds.has(r.id)))
    issues.push("A selected count rule is missing or superseded; revise the comparison explicitly");
  if (rules.some((r) => r.metric !== def.metric || r.outputUnit !== def.outputUnit))
    issues.push("Selected rules do not share the defined metric and exact output unit");
  if (new Set(rules.map((r) => r.effectiveFrom + ":" + r.effectiveTo)).size !== 1)
    issues.push("Rule effective periods differ");
  const active = latestCountVersions(records).filter(
    (r) => r.metric === def.metric && def.physicalReferences.includes(r.physicalReference),
  );
  const parties = [...new Set(active.map((r) => r.party))];
  const results = parties.map((party) => {
    const rows = active.filter((r) => r.party === party),
      reasons = [...issues];
    const refs = [...new Set(rows.map((r) => r.physicalReference))];
    if (def.physicalReferences.some((ref) => !refs.includes(ref)))
      reasons.push(
        "Source organization does not cover every physical reference in the agreed comparison scope",
      );
    const chosen = new Map<string, CountRecord[]>();
    for (const row of rows) {
      const matching = rules.filter((r) => r.inputBasis === row.basis);
      if (matching.length !== 1) {
        reasons.push("Exactly one explicit mapping is required for basis " + row.basis);
        continue;
      }
      const r = matching[0];
      chosen.set(r.id, [...(chosen.get(r.id) ?? []), row]);
    }
    // Different bases for the same physical event can be duplicate assertions, not additive activity.
    for (const ref of refs)
      if (new Set(rows.filter((r) => r.physicalReference === ref).map((r) => r.basis)).size > 1)
        reasons.push(
          "Multiple source bases for one physical event require source reconciliation: " + ref,
        );
    let total = 0;
    const sourceIds: string[] = [];
    for (const [id, subset] of chosen) {
      const r = rules.find((r) => r.id === id)!;
      const result = reconcileCounts(subset, r)[0];
      reasons.push(...result.reasons);
      if (result.total !== null) total += result.total;
      sourceIds.push(...result.sourceIds);
    }
    const kpi = def.kpiDefinitionId ? kpis.find((k) => k.id === def.kpiDefinitionId) : null;
    let hours: number | null = null,
      perHour: number | null = null;
    const productivityReasons: string[] = [];
    let clockSourceIds: string[] = [];
    if (def.kpiDefinitionId) {
      if (!kpi || kpis.some((k) => k.supersedes_id === kpi.id))
        productivityReasons.push("Selected clock definition is missing or superseded");
      else if (
        def.physicalReferences.length !== 1 ||
        kpi.physical_reference !== def.physicalReferences[0]
      )
        productivityReasons.push(
          "Quantity scope must match exactly one evidenced KPI physical reference",
        );
      else if (!["AGREED", "CONTRACTUALLY_SPECIFIED"].includes(kpi.acceptance))
        productivityReasons.push("Clock definition is not agreed or contractually specified");
      else {
        const duration = evaluateKpi(kpi, clocks, decisions);
        hours = duration.hours;
        clockSourceIds = duration.sourceIds;
        if (duration.status !== "DERIVED" || !hours)
          productivityReasons.push("Positive reconciled clock duration is required");
        else {
          const times = (kind: string) =>
            reconciledClockGroup(
              clocks.filter(
                (c) => c.physical_reference === kpi.physical_reference && c.kind === kind,
              ),
              decisions,
            ).times;
          const a = times(kpi.start_kind)[0],
            b = times(kpi.end_kind)[0];
          if (rows.some((r) => Date.parse(r.occurredAt) < a || Date.parse(r.occurredAt) > b))
            productivityReasons.push("Count timestamp falls outside the selected clock interval");
          else if (!reasons.length) perHour = countProductivity(total, hours);
        }
      }
    }
    return {
      party,
      total: reasons.length ? null : total,
      status: reasons.length ? "WITHHELD" : "DERIVED",
      reasons: [...new Set(reasons)],
      sourceIds,
      ruleIds: [...chosen.keys()],
      hours,
      perHour,
      clockSourceIds,
      productivityReasons,
    };
  });
  return {
    comparable: results.length >= 2 && results.every((r) => r.status === "DERIVED"),
    issues:
      parties.length < 2
        ? [...issues, "At least two source organizations are needed for comparison"]
        : issues,
    results,
  };
}

export function comparisonFromDb(r: any): CountComparison {
  return {
    id: r.id,
    version: r.version,
    caseId: r.case_id,
    name: r.name,
    metric: r.metric,
    outputUnit: r.output_unit,
    ruleIds: r.rule_ids,
    physicalReferences: r.physical_references,
    kpiDefinitionId: r.kpi_definition_id,
    acceptance: r.acceptance,
    rationale: r.rationale,
    sourceDocumentId: r.source_document_id,
    sourceReference: r.source_reference,
    supersedesId: r.supersedes_id,
  };
}
