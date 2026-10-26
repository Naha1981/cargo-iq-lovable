import { requireIntegratedFeatureReady } from "@/lib/integrated-feature-gate";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { tenantMiddleware } from "@/lib/auth-middleware";
import {
  RECOVERY_STATUSES,
  assertValidTransition,
  compareInvoiceLines,
  findingTypeFor,
  invoiceLine,
  summariseDiscrepancies,
} from "@/lib/revenue-recovery";

// Entity audit is written atomically by the proposed database triggers.
// Deploy only with docs/proposals/feature_atomic_audit.sql after approval.

export const listRecoveryFindings = createServerFn({ method: "GET" })
  .validator(
    z.object({
      caseId: z.string().uuid().optional(),
      status: z.enum(RECOVERY_STATUSES).optional(),
    }),
  )
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    requireIntegratedFeatureReady();
    let q = context.supabase
      .from("recovery_findings")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .order("created_at", { ascending: false });
    if (data.caseId) q = q.eq("case_id", data.caseId);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

export const getRecoveryFinding = createServerFn({ method: "GET" })
  .validator(z.object({ findingId: z.string().uuid() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    requireIntegratedFeatureReady();
    const { data: f, error } = await context.supabase
      .from("recovery_findings")
      .select("*")
      .eq("id", data.findingId)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!f) throw new Error("FINDING_NOT_FOUND");
    const { data: history, error: hErr } = await context.supabase
      .from("recovery_finding_events")
      .select("action,actor,detail,created_at")
      .eq("finding_id", data.findingId)
      .eq("tenant_id", context.tenantId)
      .order("created_at", { ascending: true });
    if (hErr) throw hErr;
    return { finding: f, history: history ?? [] };
  });

export const runInvoiceComparison = createServerFn({ method: "POST" })
  .validator(
    z.object({
      caseId: z.string().uuid().optional(),
      title: z.string().min(1).max(300),
      requestId: z.string().uuid(),
      expected: z.array(invoiceLine).min(1).max(500),
      actual: z.array(invoiceLine).min(1).max(500),
      sourceDocumentIds: z.array(z.string().uuid()).max(100).default([]),
    }),
  )
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    requireIntegratedFeatureReady();
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    if (data.caseId) {
      const { data: caseRow, error } = await context.supabase
        .from("cases")
        .select("id")
        .eq("id", data.caseId)
        .eq("tenant_id", context.tenantId)
        .maybeSingle();
      if (error) throw error;
      if (!caseRow) throw new Error("CASE_NOT_FOUND");
    }
    if (data.sourceDocumentIds.length) {
      const { data: docs, error } = await context.supabase
        .from("documents")
        .select("id,case_id")
        .eq("tenant_id", context.tenantId)
        .in("id", data.sourceDocumentIds);
      if (error) throw error;
      if (
        new Set(docs?.map((d) => d.id)).size !== new Set(data.sourceDocumentIds).size ||
        docs?.some((d) => data.caseId && d.case_id !== data.caseId)
      )
        throw new Error("SOURCE_DOCUMENT_NOT_IN_CASE");
    }
    const discrepancies = compareInvoiceLines(data.expected, data.actual);
    const summary = summariseDiscrepancies(discrepancies);
    if (discrepancies.length === 0) {
      return { created: [], summary };
    }
    const rows = discrepancies.map((d) => ({
      case_id: data.caseId ?? null,
      finding_type: findingTypeFor(d.kind),
      title: data.title + ": " + d.description,
      expected_amount: d.expectedAmount,
      actual_amount: d.actualAmount,
      currency: d.currency,
      calculation: { kind: d.kind, difference: d.difference, breakdown: d.breakdown },
      source_document_ids: data.sourceDocumentIds,
      evidence_refs: data.sourceDocumentIds.map((id) => ({ kind: "document", id })),
    }));
    const { data: created, error } = await context.supabase.rpc("cargoiq_create_recovery_batch", {
      p_tenant: context.tenantId,
      p_request: data.requestId,
      p_rows: rows,
    });
    if (error) throw error;
    return { created: created ?? [], summary };
  });

export const updateRecoveryStatus = createServerFn({ method: "POST" })
  .validator(
    z.object({
      findingId: z.string().uuid(),
      to: z.enum(RECOVERY_STATUSES),
      note: z.string().max(2000).optional(),
      confirmRecovered: z.literal(true).optional(),
    }),
  )
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    requireIntegratedFeatureReady();
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const { data: current, error } = await context.supabase
      .from("recovery_findings")
      .select("id,status,calculation")
      .eq("id", data.findingId)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!current) throw new Error("FINDING_NOT_FOUND");
    assertValidTransition(current.status as never, data.to);
    if (data.to === "recovered" && data.confirmRecovered !== true)
      throw new Error(
        "RECOVERY_CONFIRMATION_REQUIRED: mark recovered only after the money is confirmed received",
      );
    const { data: updated, error: uErr } = await context.supabase
      .from("recovery_findings")
      .update({
        status: data.to,
        calculation: {
          ...(current.calculation &&
          typeof current.calculation === "object" &&
          !Array.isArray(current.calculation)
            ? current.calculation
            : {}),
          reviewNote: data.note ?? null,
          ...(data.to === "recovered"
            ? {
                recoveredConfirmation: {
                  confirmed: true,
                  actor: context.user.id,
                  at: new Date().toISOString(),
                },
              }
            : {}),
        },
        reviewed_by: context.user.id,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.findingId)
      .eq("tenant_id", context.tenantId)
      .eq("status", current.status)
      .select("*")
      .maybeSingle();
    if (!updated && !uErr) throw new Error("FINDING_CHANGED: reload before retrying");
    if (uErr) throw uErr;

    return updated;
  });

export const assignRecoveryFinding = createServerFn({ method: "POST" })
  .validator(z.object({ findingId: z.string().uuid(), assignee: z.string().uuid().nullable() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    requireIntegratedFeatureReady();
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    if (data.assignee) {
      const { data: member, error } = await context.supabase
        .from("user_roles")
        .select("user_id")
        .eq("tenant_id", context.tenantId)
        .eq("user_id", data.assignee)
        .in("role", ["admin", "investigator"])
        .maybeSingle();
      if (error) throw error;
      if (!member) throw new Error("ASSIGNEE_NOT_IN_WORKSPACE");
    }
    const { data: updated, error } = await context.supabase
      .from("recovery_findings")
      .update({ assigned_to: data.assignee, updated_at: new Date().toISOString() })
      .eq("id", data.findingId)
      .eq("tenant_id", context.tenantId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!updated) throw new Error("FINDING_NOT_FOUND");

    return { ok: true };
  });

export const listRecoveryOwners = createServerFn({ method: "GET" })
  .middleware([tenantMiddleware])
  .handler(async ({ context }) => {
    requireIntegratedFeatureReady();
    const { data, error } = await context.supabase
      .from("user_roles")
      .select("user_id,role")
      .eq("tenant_id", context.tenantId)
      .in("role", ["admin", "investigator"]);
    if (error) throw error;
    return data ?? [];
  });
