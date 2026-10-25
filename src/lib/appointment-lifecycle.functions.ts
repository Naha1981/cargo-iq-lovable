import { lifecycleFromDb } from "./appointment-lifecycle";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { tenantMiddleware } from "./auth-middleware";
import { appointmentLifecycleInput, type AppointmentLifecycle } from "./appointment-lifecycle";
export const listAppointmentLifecycle = createServerFn({ method: "GET" })
  .validator(z.object({ caseId: z.string().uuid() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("appointment_lifecycle")
      .select("*")
      .eq("case_id", data.caseId)
      .order("created_at", { ascending: true });
    if (error)
      throw new Error(
        "Appointment lifecycle unavailable. Apply the reviewed migration before use. " +
          error.message,
      );
    return (rows ?? []).map(lifecycleFromDb);
  });
export const appendAppointmentLifecycle = createServerFn({ method: "POST" })
  .validator(appointmentLifecycleInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data: d, context: c }) => {
    if (!["admin", "investigator"].includes(c.role))
      throw new Error("Investigator access required");
    const { data, error } = await c.supabase
      .from("appointment_lifecycle")
      .insert({
        tenant_id: c.tenantId,
        case_id: d.caseId,
        appointment_reference: d.appointmentReference,
        physical_reference: d.physicalReference,
        record_type: d.recordType,
        issuer: d.issuer,
        party: d.party,
        start_at: d.startAt,
        end_at: d.endAt,
        occurred_at: d.occurredAt,
        claim_target: d.claimTarget,
        outcome: d.outcome,
        explanation: d.explanation,
        terms_reference: d.termsReference,
        source_document_id: d.sourceDocumentId,
        source_reference: d.sourceReference,
        supersedes_id: d.supersedesId,
      })
      .select("*")
      .single();
    if (error) throw error;
    return lifecycleFromDb(data);
  });
