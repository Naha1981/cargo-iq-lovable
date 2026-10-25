import { comparisonFromDb } from "./count-comparisons";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { tenantMiddleware } from "./auth-middleware";
import { countComparisonInput, type CountComparison } from "./count-comparisons";
export const listCountComparisons = createServerFn({ method: "GET" })
  .validator(z.object({ caseId: z.string().uuid() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context: c }) => {
    const names = [
      "count_comparison_definitions",
      "kpi_definitions",
      "operational_clocks",
      "clock_reconciliations",
    ] as const;
    const res = await Promise.all(
      names.map((n) =>
        c.supabase
          .from(n)
          .select("*")
          .eq("case_id", data.caseId)
          .order("created_at", { ascending: true }),
      ),
    );
    for (const r of res) if (r.error) throw r.error;
    return {
      comparisons: (res[0].data ?? []).map(comparisonFromDb),
      kpis: res[1].data ?? [],
      clocks: res[2].data ?? [],
      decisions: res[3].data ?? [],
    };
  });
export const appendCountComparison = createServerFn({ method: "POST" })
  .validator(countComparisonInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data: d, context: c }) => {
    if (!["admin", "investigator"].includes(c.role))
      throw new Error("Investigator access required");
    const { data, error } = await c.supabase
      .from("count_comparison_definitions")
      .insert({
        tenant_id: c.tenantId,
        case_id: d.caseId,
        name: d.name,
        metric: d.metric,
        output_unit: d.outputUnit,
        rule_ids: d.ruleIds,
        physical_references: d.physicalReferences,
        kpi_definition_id: d.kpiDefinitionId,
        acceptance: d.acceptance,
        rationale: d.rationale,
        source_document_id: d.sourceDocumentId,
        source_reference: d.sourceReference,
        supersedes_id: d.supersedesId,
      })
      .select("*")
      .single();
    if (error) throw error;
    return comparisonFromDb(data);
  });
