import { latestCountVersions, recordFromDb, ruleFromDb } from "./count-ledger";
import {
  comparisonFromDb,
  evaluateCountComparison,
  type CountComparison,
} from "./count-comparisons";
import { lifecycleFromDb, evaluateAppointment } from "./appointment-lifecycle";

export type FrozenOpsPayload = {
  countEngineVersion?: unknown;
  countComparisons?: Parameters<typeof comparisonFromDb>[0][];
  countSourceRecords?: Parameters<typeof recordFromDb>[0][];
  countRuleVersions?: Parameters<typeof ruleFromDb>[0][];
  kpiDefinitions?: Parameters<typeof evaluateCountComparison>[3];
  operationalClocks?: Parameters<typeof evaluateCountComparison>[4];
  clockReconciliations?: Parameters<typeof evaluateCountComparison>[5];
  appointmentLifecycle?: Parameters<typeof lifecycleFromDb>[0][];
};

/** V1 uses only frozen source rows. Never reads current case state. */
export function frozenOperationalResults(p: FrozenOpsPayload) {
  if (p.countEngineVersion !== "1") return { counts: [], appointments: [] };
  return {
    counts: latestCountVersions<CountComparison>(
      (p.countComparisons ?? []).map(comparisonFromDb),
    ).map((def) => ({
      definition: def,
      result: evaluateCountComparison(
        def,
        (p.countSourceRecords ?? []).map(recordFromDb),
        (p.countRuleVersions ?? []).map(ruleFromDb),
        p.kpiDefinitions ?? [],
        p.operationalClocks ?? [],
        p.clockReconciliations ?? [],
      ),
    })),
    appointments: evaluateAppointment((p.appointmentLifecycle ?? []).map(lifecycleFromDb)),
  };
}
