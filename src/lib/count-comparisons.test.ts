import { describe, it, expect } from "vitest";
import { evaluateCountComparison, type CountComparison } from "./count-comparisons";
import type { CountRule, CountRecord } from "./count-ledger";
const rule: CountRule = {
  id: "r1",
  version: 1,
  caseId: "c",
  name: "lift mapping",
  metric: "HATCH_COVER",
  inputBasis: "INDIVIDUAL_LIFT",
  outputUnit: "operation",
  calculation: "EXPLICIT_FACTOR",
  numerator: 1,
  denominator: 4,
  gateKinds: [],
  acceptance: "AGREED",
  effectiveFrom: "2026-10-01T00:00:00Z",
  effectiveTo: null,
  sourceDocumentId: "d",
  sourceReference: "p1",
  rationale: "Synthetic agreed mapping",
  supersedesId: null,
};
const rules = [
  rule,
  {
    ...rule,
    id: "r2",
    name: "operation mapping",
    inputBasis: "HATCH_OPERATION" as const,
    numerator: 1,
    denominator: 1,
  },
];
const r: CountRecord = {
  id: "s1",
  version: 1,
  caseId: "c",
  physicalReference: "HATCH-001",
  party: "Terminal",
  metric: "HATCH_COVER",
  basis: "INDIVIDUAL_LIFT",
  quantity: 4,
  occurredAt: "2026-10-16T10:00:00Z",
  containers20: null,
  containers40: null,
  gateKind: "NOT_APPLICABLE",
  sourceDocumentId: "d",
  sourceReference: "row1",
  limitations: "Synthetic mapping only",
  supersedesId: null,
};
const records = [
  r,
  { ...r, id: "s2", party: "Carrier", basis: "HATCH_OPERATION" as const, quantity: 1 },
];
const def: CountComparison = {
  id: "comp",
  version: 1,
  caseId: "c",
  name: "Same hatch operation",
  metric: "HATCH_COVER",
  outputUnit: "operation",
  ruleIds: ["r1", "r2"],
  physicalReferences: ["HATCH-001"],
  kpiDefinitionId: null,
  acceptance: "AGREED",
  rationale: "Same physical event evidenced in signed sources",
  sourceDocumentId: "d",
  sourceReference: "p1",
  supersedesId: null,
};
describe("explicit common-unit count comparison", () => {
  it("compares different source bases only via explicit accepted mappings", () => {
    const x = evaluateCountComparison(def, records, rules);
    expect(x.comparable).toBe(true);
    expect(x.results.map((r) => r.total)).toEqual([1, 1]);
  });
  it("withholds stale mapping, ambiguous factors, output mismatch and missing scope", () => {
    for (const [d, rr] of [
      [{ ...def, physicalReferences: ["HATCH-001", "HATCH-002"] }, rules],
      [def, [...rules, { ...rule, id: "r3", supersedesId: "r1" }]],
      [{ ...def, outputUnit: "move" }, rules],
      [{ ...def, ruleIds: ["r1", "r2", "r3"] }, [...rules, { ...rule, id: "r3" }]],
    ] as const)
      expect(evaluateCountComparison(d as CountComparison, records, [...rr]).comparable).toBe(
        false,
      );
  });
  it("never sums duplicate source bases for same party/physical event", () => {
    const x = evaluateCountComparison(
      def,
      [...records, { ...records[1], id: "extra", party: "Terminal" }],
      rules,
    );
    expect(x.results[0].total).toBeNull();
  });
  it("quantity productivity uses the selected current positive reconciled interval", () => {
    const kpi = {
      id: "k",
      acceptance: "AGREED",
      physical_reference: "HATCH-001",
      start_kind: "GATE_IN",
      end_kind: "GATE_OUT",
      benchmark_hours: null,
    };
    const clocks = [
      {
        id: "c1",
        physical_reference: "HATCH-001",
        kind: "GATE_IN",
        timestamp_original: "2026-10-16T09:00:00Z",
      },
      {
        id: "c2",
        physical_reference: "HATCH-001",
        kind: "GATE_OUT",
        timestamp_original: "2026-10-16T11:00:00Z",
      },
    ];
    expect(
      evaluateCountComparison({ ...def, kpiDefinitionId: "k" }, records, rules, [kpi], clocks)
        .results[0].perHour,
    ).toBe(0.5);
    expect(
      evaluateCountComparison(
        { ...def, kpiDefinitionId: "k" },
        records,
        rules,
        [kpi],
        [...clocks, { ...clocks[1], id: "c3", timestamp_original: "2026-10-16T12:00:00Z" }],
      ).results[0].perHour,
    ).toBeNull();
    expect(
      evaluateCountComparison(
        { ...def, kpiDefinitionId: "k" },
        records.map((r) => ({ ...r, occurredAt: "2026-10-16T15:00:00Z" })),
        rules,
        [kpi],
        clocks,
      ).results[0].perHour,
    ).toBeNull();
  });
});
