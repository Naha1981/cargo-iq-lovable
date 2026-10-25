import { comparisonFromDb } from "./count-comparisons";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { tenantMiddleware } from "./auth-middleware";
import { countComparisonInput, type CountComparison } from "./count-comparisons";
export const listCountComparisons = createServerFn({ method: "GET" })
  .validator(z.object({ caseId: z.string().uuid() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context: c }) => {
    const byCreated = { ascending: true } as const;
    const [comparisons, kpis, clocks, decisions] = await Promise.all([
      c.supabase
        .from("count_comparison_definitions")
        .select("*")
        .eq("case_id", data.caseId)
        .order("created_at", byCreated),
      c.supabase
        .from("kpi_definitions")
        .select("*")
        .eq("case_id", data.caseId)
        .order("created_at", byCreated),
      c.supabase
        .from("operational_clocks")
        .select("*")
        .eq("case_id", data.caseId)
        .order("created_at", byCreated),
      c.supabase
        .from("clock_reconciliations")
        .select("*")
        .eq("case_id", data.caseId)
        .order("created_at", byCreated),
    ]);
    for (const r of [comparisons, kpis, clocks, decisions]) if (r.error) throw r.error;
    return {
      comparisons: (comparisons.data ?? []).map(comparisonFromDb),
      kpis: kpis.data ?? [],
      clocks: clocks.data ?? [],
      decisions: decisions.data ?? [],
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
