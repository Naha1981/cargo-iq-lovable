import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { tenantMiddleware } from "@/lib/auth-middleware";
import { gapInput } from "@/lib/evidence-gaps";
export const listEvidenceGaps = createServerFn({ method: "GET" })
  .validator(z.object({ caseId: z.string().uuid() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("evidence_gap_entries")
      .select("*")
      .eq("case_id", data.caseId)
      .eq("tenant_id", context.tenantId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return rows ?? [];
  });
export const appendEvidenceGap = createServerFn({ method: "POST" })
  .validator(gapInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const { data: row, error } = await context.supabase
      .from("evidence_gap_entries")
      .insert({
        tenant_id: context.tenantId,
        case_id: data.caseId,
        physical_reference: data.physicalReference,
        required_event: data.requiredEvent,
        requirement_basis: data.requirementBasis,
        status: data.status,
        explanation: data.explanation,
        document_ids: data.documentIds,
        evidence_reference: data.evidenceReference,
        supersedes_id: data.supersedesId,
      })
      .select("*")
      .single();
    if (error) throw error;
    return row;
  });
