import { describe, it, expect } from "vitest";
import {
  reconcileCounts,
  countProductivity,
  countRuleInput,
  countRecordInput,
  type CountRule,
  type CountRecord,
} from "./count-ledger";
const uuid = "11111111-1111-4111-8111-111111111111";
const rule: CountRule = {
  id: "r",
  version: 1,
  caseId: uuid,
  name: "Source-agreed hatch basis",
  metric: "HATCH_COVER",
  inputBasis: "INDIVIDUAL_LIFT",
  outputUnit: "hatch operation",
  calculation: "EXPLICIT_FACTOR",
  numerator: 1,
  denominator: 4,
  gateKinds: [],
  acceptance: "AGREED",
  effectiveFrom: "2026-10-01T00:00:00Z",
  effectiveTo: null,
  sourceDocumentId: uuid,
  sourceReference: "p.1",
  rationale: "Four separate lids count as one operation under this signed source",
  supersedesId: null,
};
const record: CountRecord = {
  id: "s",
  version: 1,
  caseId: uuid,
  physicalReference: "HATCH-001",
  party: "Terminal",
  metric: "HATCH_COVER",
  basis: "INDIVIDUAL_LIFT",
  quantity: 4,
  occurredAt: "2026-10-16T10:00:00Z",
  containers20: null,
  containers40: null,
  gateKind: "NOT_APPLICABLE",
  sourceDocumentId: uuid,
  sourceReference: "row1",
  limitations: "Party reports same physical hatch operation",
  supersedesId: null,
};
describe("source-preserving local count engine", () => {
  it("four lifts become one operation only under an explicit agreed factor", () => {
    expect(reconcileCounts([record], rule)[0].total).toBe(1);
    expect(record.quantity).toBe(4);
    expect(reconcileCounts([record], { ...rule, acceptance: "UNRESOLVED" })[0].total).toBeNull();
  });
  it("never conflates a box count with a truck or incompatible input basis", () => {
    expect(reconcileCounts([record], { ...rule, inputBasis: "HATCH_OPERATION" })[0].status).toBe(
      "WITHHELD",
    );
    const truck = {
      ...record,
      metric: "TRUCK_VISIT" as const,
      basis: "TRUCK_VISIT" as const,
      quantity: 1,
      containers20: 2,
      containers40: 0,
    };
    const r = {
      ...rule,
      metric: "TRUCK_VISIT" as const,
      inputBasis: "TRUCK_VISIT" as const,
      numerator: 1,
      denominator: 1,
    };
    expect(reconcileCounts([truck], { ...r, calculation: "PER_PHYSICAL_REFERENCE" })[0].total).toBe(
      1,
    );
    expect(
      reconcileCounts([truck], { ...r, calculation: "CONTAINERS_FROM_MANIFEST" })[0].total,
    ).toBe(2);
    expect(reconcileCounts([truck], { ...r, calculation: "TEU_FROM_MANIFEST" })[0].total).toBe(2);
  });
  it("gate in/out can be2events or1visit; virtual gates only if selected", () => {
    const one = {
      ...record,
      metric: "GATE_COUNT" as const,
      basis: "GATE_EVENT" as const,
      quantity: 1,
      gateKind: "PHYSICAL_IN" as const,
    };
    const two = { ...one, id: "out", gateKind: "PHYSICAL_OUT" as const };
    const virtual = { ...one, id: "v", gateKind: "VIRTUAL_IN" as const };
    const r = {
      ...rule,
      metric: "GATE_COUNT" as const,
      inputBasis: "GATE_EVENT" as const,
      numerator: 1,
      denominator: 1,
      gateKinds: ["PHYSICAL_IN", "PHYSICAL_OUT"] as CountRule["gateKinds"],
    };
    expect(
      reconcileCounts([one, two, virtual], { ...r, calculation: "AS_REPORTED" })[0].total,
    ).toBe(2);
    expect(
      reconcileCounts([one, two, virtual], { ...r, calculation: "PER_PHYSICAL_REFERENCE" })[0]
        .total,
    ).toBe(1);
  });
  it("duplicate physical identities, stale periods and unknown manifest composition withhold", () => {
    expect(reconcileCounts([record, { ...record, id: "dup" }], rule)[0].total).toBeNull();
    expect(
      reconcileCounts([record], { ...rule, effectiveTo: "2026-10-15T00:00:00Z" })[0].total,
    ).toBeNull();
    const truck = { ...record, metric: "TRUCK_VISIT" as const, basis: "TRUCK_VISIT" as const };
    expect(
      reconcileCounts([truck], {
        ...rule,
        metric: "TRUCK_VISIT",
        inputBasis: "TRUCK_VISIT",
        calculation: "CONTAINERS_FROM_MANIFEST",
        numerator: 1,
        denominator: 1,
      })[0].total,
    ).toBeNull();
  });
  it("latest corrections keep history but do not double-count", () => {
    expect(
      reconcileCounts(
        [record, { ...record, id: "s2", version: 2, quantity: 8, supersedesId: "s" }],
        rule,
      )[0].total,
    ).toBe(2);
  });
  it("separates organizations rather than summing them", () => {
    const result = reconcileCounts(
      [record, { ...record, id: "b", party: "Carrier", quantity: 8 }],
      rule,
    );
    expect(result.map((x) => x.total)).toEqual([1, 2]);
  });
  it("validates metric/basis and factor/period provenance", () => {
    expect(countRecordInput.safeParse(record).success).toBe(true);
    expect(countRecordInput.safeParse({ ...record, basis: "TRUCK_VISIT" }).success).toBe(false);
    expect(countRuleInput.safeParse(rule).success).toBe(true);
    expect(countRuleInput.safeParse({ ...rule, denominator: 0 }).success).toBe(false);
  });
  it("quantity/hour only uses positive evidenced duration", () => {
    expect(countProductivity(30, 2)).toBe(15);
    expect(countProductivity(30, 0)).toBeNull();
    expect(countProductivity(null, 2)).toBeNull();
  });
});
