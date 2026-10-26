import { requireIntegratedFeatureReady } from "@/lib/integrated-feature-gate";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { tenantMiddleware } from "@/lib/auth-middleware";
import {
  REVIEW_STATUSES,
  assertConfirmable,
  assertReviewTransition,
  findingInput,
  relateTimes,
} from "@/lib/gehi";

// Entity audit is written atomically by the proposed database triggers.
// Deploy only with docs/proposals/feature_atomic_audit.sql after approval.

export const listGeospatialFindings = createServerFn({ method: "GET" })
  .validator(
    z.object({
      caseId: z.string().uuid().optional(),
      reviewStatus: z.enum(REVIEW_STATUSES).optional(),
    }),
  )
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    requireIntegratedFeatureReady();
    let q = context.supabase
      .from("geospatial_findings")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .order("created_at", { ascending: false });
    if (data.caseId) q = q.eq("case_id", data.caseId);
    if (data.reviewStatus) q = q.eq("review_status", data.reviewStatus);
    const { data: rows, error } = await q;
    if (error) throw error;
    return (rows ?? []).map((r) => ({
      ...r,
      timeRelation: relateTimes(r.event_time ?? undefined, r.observation_time ?? undefined),
    }));
  });

export const createGeospatialFinding = createServerFn({ method: "POST" })
  .validator(findingInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    requireIntegratedFeatureReady();
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const { data: row, error } = await context.supabase
      .from("geospatial_findings")
      .insert({
        tenant_id: context.tenantId,
        case_id: data.caseId ?? null,
        title: data.title,
        summary: data.summary ?? null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        event_time: data.eventTime ?? null,
        observation_time: data.observationTime ?? null,
        source: data.source,
        method: data.method,
        confidence: data.confidence,
        rationale: data.rationale ?? null,
        alternatives: data.alternatives ?? null,
        limitations: data.limitations ?? null,
        next_action: data.nextAction ?? null,
        created_by: context.user.id,
      })
      .select("*")
      .single();
    if (error) throw error;

    return row;
  });

export const reviewGeospatialFinding = createServerFn({ method: "POST" })
  .validator(
    z.object({
      findingId: z.string().uuid(),
      to: z.enum(REVIEW_STATUSES),
      rationale: z.string().max(4000).optional(),
    }),
  )
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    requireIntegratedFeatureReady();
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const { data: current, error } = await context.supabase
      .from("geospatial_findings")
      .select("id,review_status,rationale")
      .eq("id", data.findingId)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!current) throw new Error("FINDING_NOT_FOUND");
    assertReviewTransition(current.review_status as never, data.to);
    if (data.to === "confirmed") {
      assertConfirmable({
        review_status: current.review_status as never,
        rationale: data.rationale ?? current.rationale,
      });
    }
    const { data: updated, error: uErr } = await context.supabase
      .from("geospatial_findings")
      .update({
        review_status: data.to,
        ...(data.rationale ? { rationale: data.rationale } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.findingId)
      .eq("tenant_id", context.tenantId)
      .eq("review_status", current.review_status)
      .select("*")
      .maybeSingle();
    if (!updated && !uErr) throw new Error("RECORD_CHANGED: reload before retrying");
    if (uErr) throw uErr;

    return updated;
  });
