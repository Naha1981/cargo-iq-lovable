import { z } from "zod";
export const countMetrics = ["HATCH_COVER", "TRUCK_VISIT", "CONTAINER_DELIVERY", "GATE_COUNT"] as const;
export const countBases = ["HATCH_OPERATION", "INDIVIDUAL_LIFT", "TRUCK_VISIT", "CONTAINER", "TEU", "GATE_EVENT"] as const;
const zoned = z.string().datetime({ offset: true });
export const countRecordInput = z.object({
  caseId: z.string().uuid(), physicalReference: z.string().trim().min(3).max(200),
  party: z.string().trim().min(2).max(200), metric: z.enum(countMetrics), basis: z.enum(countBases),
  quantity: z.number().finite().nonnegative().max(1e9), occurredAt: zoned,
  containers20: z.number().int().nonnegative().max(10000).nullable(), containers40: z.number().int().nonnegative().max(10000).nullable(),
  gateKind: z.enum(["PHYSICAL_IN", "PHYSICAL_OUT", "VIRTUAL_IN", "VIRTUAL_OUT", "NOT_APPLICABLE"]),
  sourceDocumentId: z.string().uuid(), sourceReference: z.string().trim().min(3).max(1000),
  limitations: z.string().trim().min(10).max(4000), supersedesId: z.string().uuid().nullable(),
}).superRefine((r, ctx) => {
  const allowed = r.metric === "HATCH_COVER" ? ["HATCH_OPERATION", "INDIVIDUAL_LIFT"] : r.metric === "TRUCK_VISIT" ? ["TRUCK_VISIT"] : r.metric === "CONTAINER_DELIVERY" ? ["CONTAINER", "TEU"] : ["GATE_EVENT"];
  if (!allowed.includes(r.basis)) ctx.addIssue({ code: "custom", path: ["basis"], message: "Basis does not match metric" });
  if (r.metric === "GATE_COUNT" && r.gateKind === "NOT_APPLICABLE") ctx.addIssue({ code: "custom", path: ["gateKind"], message: "Classify physical/virtual and entry/exit" });
  if (r.metric !== "GATE_COUNT" && r.gateKind !== "NOT_APPLICABLE") ctx.addIssue({ code: "custom", path: ["gateKind"], message: "Gate kind applies only to gate counts" });
});
export const countRuleInput = z.object({
  caseId: z.string().uuid(), name: z.string().trim().min(3).max(200), metric: z.enum(countMetrics),
  inputBasis: z.enum(countBases), outputUnit: z.string().trim().min(1).max(100),
  calculation: z.enum(["AS_REPORTED", "PER_PHYSICAL_REFERENCE", "CONTAINERS_FROM_MANIFEST", "TEU_FROM_MANIFEST", "EXPLICIT_FACTOR"]),
  numerator: z.number().int().positive().max(1000000), denominator: z.number().int().positive().max(1000000),
  gateKinds: z.array(z.enum(["PHYSICAL_IN", "PHYSICAL_OUT", "VIRTUAL_IN", "VIRTUAL_OUT"])).max(4),
  acceptance: z.enum(["AGREED", "CONTRACTUALLY_SPECIFIED", "PARTY_REPORTED", "UNRESOLVED"]),
  effectiveFrom: zoned, effectiveTo: z.preprocess(v=>v===""?null:v,zoned.nullable()),
  sourceDocumentId: z.string().uuid(), sourceReference: z.string().trim().min(3).max(1000),
  rationale: z.string().trim().min(10).max(4000), supersedesId: z.string().uuid().nullable(),
}).superRefine((r, ctx) => {
  if (r.effectiveTo && Date.parse(r.effectiveTo) <= Date.parse(r.effectiveFrom)) ctx.addIssue({ code: "custom", path: ["effectiveTo"], message: "End must follow start" });
  if (r.metric === "GATE_COUNT" && !r.gateKinds.length) ctx.addIssue({ code: "custom", path: ["gateKinds"], message: "Select eligible gate kinds explicitly" });
  if (new Set(r.gateKinds).size !== r.gateKinds.length) ctx.addIssue({ code: "custom", path: ["gateKinds"], message: "Duplicate gate kind" });
  if (r.calculation !== "EXPLICIT_FACTOR" && (r.numerator !== 1 || r.denominator !== 1)) ctx.addIssue({ code: "custom", path: ["numerator"], message: "Only explicit-factor calculations use a factor" });
  if (["CONTAINERS_FROM_MANIFEST", "TEU_FROM_MANIFEST"].includes(r.calculation) && !["TRUCK_VISIT", "CONTAINER_DELIVERY"].includes(r.metric)) ctx.addIssue({ code: "custom", path: ["calculation"], message: "Manifest conversion requires a truck or container metric" });
});
export type CountRecord = z.infer<typeof countRecordInput> & { id: string; version: number };
export type CountRule = z.infer<typeof countRuleInput> & { id: string; version: number };
export function latestCountVersions<T extends { id: string; supersedesId: string | null }>(rows: T[]) {
  const replaced = new Set(rows.map(r => r.supersedesId).filter(Boolean)); return rows.filter(r => !replaced.has(r.id));
}
/** Never combines parties. Each party is evaluated independently under the SAME explicit rule. */
export function reconcileCounts(records: CountRecord[], rule: CountRule) {
  const active = latestCountVersions(records).filter(r => r.metric === rule.metric);
  const parties = [...new Set(active.map(r => r.party.trim()))];
  return parties.map(party => {
    const rows = active.filter(r => r.party.trim() === party);
    const reasons: string[] = [];
    if (!["AGREED", "CONTRACTUALLY_SPECIFIED"].includes(rule.acceptance)) reasons.push("Rule is not agreed or contractually specified");
    const eligible = rows.filter(r => {
      const time = Date.parse(r.occurredAt);
      if (time < Date.parse(rule.effectiveFrom) || (rule.effectiveTo && time >= Date.parse(rule.effectiveTo))) { reasons.push("Record outside rule effective period: " + r.id); return false; }
      if (r.basis !== rule.inputBasis) { reasons.push("Incompatible source basis: " + r.id); return false; }
      return r.metric !== "GATE_COUNT" || rule.gateKinds.includes(r.gateKind as CountRule["gateKinds"][number]);
    });
    // Repeated source rows for the same physical event cannot quietly inflate totals.
    const identities = eligible.map(r => r.physicalReference + (r.metric === "GATE_COUNT" ? ":" + r.gateKind : ""));
    if (new Set(identities).size !== identities.length) reasons.push("Duplicate physical-event records need source reconciliation");
    let total = 0;
    for (const r of eligible) {
      if (rule.calculation === "PER_PHYSICAL_REFERENCE") { if (eligible.findIndex(x => x.physicalReference === r.physicalReference) === eligible.indexOf(r)) total += 1; }
      else if (rule.calculation === "CONTAINERS_FROM_MANIFEST" || rule.calculation === "TEU_FROM_MANIFEST") {
        if (r.containers20 === null || r.containers40 === null) reasons.push("Missing manifest composition: " + r.id);
        else total += r.containers20 + r.containers40 * (rule.calculation === "TEU_FROM_MANIFEST" ? 2 : 1);
      } else total += r.quantity * (rule.calculation === "EXPLICIT_FACTOR" ? rule.numerator / rule.denominator : 1);
    }
    if (!eligible.length) reasons.push("No eligible source records");
    return { party, status: reasons.length ? "WITHHELD" as const : "DERIVED" as const, total: reasons.length ? null : total,
      unit: rule.outputUnit, ruleId: rule.id, ruleVersion: rule.version, sourceIds: eligible.map(r => r.id), reasons: [...new Set(reasons)],
      reported: rows.map(r => ({ id: r.id, reference: r.physicalReference, quantity: r.quantity, basis: r.basis, gateKind: r.gateKind })),
    };
  });
}
export function countProductivity(total: number | null, hours: number | null) {
  return total !== null && hours !== null && Number.isFinite(total) && total >= 0 && Number.isFinite(hours) && hours > 0 ? total / hours : null;
}
