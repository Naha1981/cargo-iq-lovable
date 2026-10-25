import { latestCountVersions, recordFromDb, ruleFromDb } from "./count-ledger";
import {
  comparisonFromDb,
  evaluateCountComparison,
  type CountComparison,
} from "./count-comparisons";
import { lifecycleFromDb, evaluateAppointment } from "./appointment-lifecycle";
/** V1 uses only frozen source rows. Never reads current case state. */
export function frozenOperationalResults(p: any) {
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
