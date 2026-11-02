import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { tenantMiddleware } from "@/lib/auth-middleware";
import { clockInput } from "@/lib/operational-clocks";
export const listOperationalClocks = createServerFn({ method: "GET" })
  .validator(z.object({ caseId: z.string().uuid() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("operational_clocks")
      .select("*")
      .eq("case_id", data.caseId)
      .eq("tenant_id", context.tenantId)
      .order("occurred_at", { ascending: true });
    if (error) throw error;
    return rows ?? [];
  });
export const addOperationalClock = createServerFn({ method: "POST" })
  .validator(clockInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const { data: row, error } = await context.supabase
      .from("operational_clocks")
      .insert({
        tenant_id: context.tenantId,
        created_by: context.user.id,
        case_id: data.caseId,
        physical_reference: data.physicalReference,
        kind: data.kind,
        timestamp_original: data.timestamp,
        occurred_at: data.timestamp,
        time_zone: data.timeZone,
        source_party: data.sourceParty,
        source_document_id: data.sourceDocumentId,
        source_reference: data.sourceReference,
        location_basis: data.locationBasis,
        appointment_issuer: data.appointmentIssuer || null,
        appointment_reference: data.appointmentReference || null,
        appointment_parties: data.appointmentParties || null,
        appointment_terms: data.appointmentTerms || null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return row;
  });

export const listClockReconciliations = createServerFn({ method: "GET" })
  .validator(z.object({ caseId: z.string().uuid() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("clock_reconciliations")
      .select("*")
      .eq("case_id", data.caseId)
      .eq("tenant_id", context.tenantId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return rows ?? [];
  });
export const reconcileOperationalClock = createServerFn({ method: "POST" })
  .validator(
    z.object({
      caseId: z.string().uuid(),
      selectedClockId: z.string().uuid(),
      explanation: z.string().trim().min(10).max(4000),
      sourceDocumentId: z.string().uuid(),
      sourceReference: z.string().trim().min(3).max(1000),
    }),
  )
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const { data: clock, error: clockErr } = await context.supabase
      .from("operational_clocks")
      .select("kind, physical_reference")
      .eq("id", data.selectedClockId)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (clockErr || !clock) throw new Error("Selected clock not found in this workspace");
    const { data: row, error } = await context.supabase
      .from("clock_reconciliations")
      .insert({
        tenant_id: context.tenantId,
        case_id: data.caseId,
        physical_reference: clock.physical_reference,
        kind: clock.kind,
        selected_clock_id: data.selectedClockId,
        considered_clock_ids: [data.selectedClockId],
        explanation: data.explanation,
        source_document_id: data.sourceDocumentId,
        source_reference: data.sourceReference,
        version: 1,
        created_by: context.user.id,
      })
      .select("*")
      .single();
    if (error) throw error;
    return row;
  });
