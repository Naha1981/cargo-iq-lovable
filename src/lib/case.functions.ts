import { assertDocumentSize } from "./extraction-policy";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { tenantMiddleware } from "@/lib/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { sha256Hex, stableCanonical } from "@/lib/hash";
import { resolvePortCenter } from "@/lib/port-centers";
import {
  UPLOAD_IDEMPOTENCY_WINDOW_MS,
  parseUploadConcurrency,
  parseUploadSlotTtl,
} from "@/lib/upload-backpressure";
import { caseRecovery } from "@/lib/recovery-gate";
import { calculateDemurrage } from "@/lib/investigation-engine";
import { buildAisBoundingBox, fetchAisSnapshot } from "@/lib/adapters/ais-adapter";
import { querySentinelScenes } from "@/lib/adapters/satellite-adapter";
import { fetchPortConditions } from "@/lib/adapters/weather-port-adapter";
import { extractDocumentClaimsForPath } from "@/lib/extraction.functions";

const idInput = z.object({ caseId: z.string().uuid() });
async function clockBlocked(db: SupabaseClient<Database>, caseId: string): Promise<boolean> {
  const { data, error } = await db.rpc("has_unresolved_operational_clocks", { _case_id: caseId });
  if (error) throw error;
  return Boolean(data);
}
async function assertClockGate(db: SupabaseClient<Database>, caseId: string) {
  if (await clockBlocked(db, caseId))
    throw new Error("BLOCKED: reconcile conflicting operational clock evidence first.");
}

// Audit item 10: prefer one batched RPC; while migration
// 20261024214000_batched_clock_check.sql is not yet applied on an environment,
// fall back to the original per-case checks so code and migration roll out in
// either order (PGRST202 = RPC not found in PostgREST schema cache).
async function unresolvedClockSet(
  supabase: SupabaseClient<Database>,
  ids: string[],
): Promise<Set<string>> {
  if (!ids.length) return new Set<string>();
  const { data: blockedRows, error } = await supabase.rpc(
    "cases_with_unresolved_operational_clocks",
    { _case_ids: ids },
  );
  if (!error) return new Set<string>((blockedRows ?? []).map((r) => r));
  if (error.code !== "PGRST202" && error.code !== "42883") throw error;
  const blocked = new Set<string>();
  for (const id of ids) if (await clockBlocked(supabase, id)) blocked.add(id);
  return blocked;
}

type CaseListRow = Database["public"]["Tables"]["cases"]["Row"];
type CalcLite = {
  case_id: string;
  calculated_amount_minor: number | null;
  charged_amount_minor: number | null;
  currency: string | null;
};
type ContraLite = { case_id: string; status: string };

async function enrichCaseRows(supabase: SupabaseClient<Database>, cases: CaseListRow[]) {
  const ids = cases.map((c) => c.id);
  const { data: calcs } = ids.length
    ? await supabase
        .from("financial_calculations")
        .select("case_id,calculated_amount_minor,charged_amount_minor,currency,variance_minor")
        .in("case_id", ids)
        .order("created_at", { ascending: false })
    : { data: [] as never[] };
  const { data: contradictions } = ids.length
    ? await supabase.from("contradictions").select("case_id,status").in("case_id", ids)
    : { data: [] as never[] };
  const blockedCaseIds = await unresolvedClockSet(supabase, ids);

  const latestCalc = new Map<string, CalcLite>();
  for (const row of calcs ?? []) if (!latestCalc.has(row.case_id)) latestCalc.set(row.case_id, row);

  return Promise.all(
    cases.map(async (c) => {
      const calc = latestCalc.get(c.id);
      const openContradictions = (contradictions ?? []).filter(
        (x) => x.case_id === c.id && x.status === "FLAGGED",
      ).length;
      const unresolvedClocks = blockedCaseIds.has(c.id);
      const charged = calc?.charged_amount_minor ? Number(calc.charged_amount_minor) / 100 : 0;
      const calculated = calc?.calculated_amount_minor
        ? Number(calc.calculated_amount_minor) / 100
        : 0;
      return {
        ...c,
        currency: calc?.currency ?? "ZAR",
        exposure: charged,
        recovery: caseRecovery(
          charged,
          calculated,
          openContradictions + (unresolvedClocks ? 1 : 0),
        ),
        contradictions: openContradictions,
        clockConflicts: unresolvedClocks,
      };
    }),
  );
}

// --- Bounded dashboard (audit item 10) ------------------------------------------
// listCases previously selected EVERY case with select("*") and ran one clock RPC
// per case. Replaced by: (a) keyset-paged register with server-side search, and
// (b) exact stats from LIGHT projections. No unbounded reads remain on this path.

// Identical definitions to the dashboard's previous client-side derivation over
// the full enriched set; computed here from light projections (no select("*"),
// no per-case RPCs) so stats stay exact without loading every case row.
export function computeDashboardStats(
  cases: { id: string; status: string }[],
  calcs: CalcLite[],
  contradictions: ContraLite[],
  blockedCaseIds: Set<string>,
) {
  const latestCalc = new Map<string, CalcLite>();
  for (const row of calcs ?? []) if (!latestCalc.has(row.case_id)) latestCalc.set(row.case_id, row);
  let openCases = 0,
    contradictionCount = 0,
    exposureZar = 0,
    recoveryZar = 0,
    recoveryBlocked = false;
  for (const c of cases ?? []) {
    if (c.status !== "CLOSED") openCases++;
    const calc = latestCalc.get(c.id);
    const openContra = (contradictions ?? []).filter(
      (x) => x.case_id === c.id && x.status === "FLAGGED",
    ).length;
    const clockBlockedCase = blockedCaseIds.has(c.id);
    contradictionCount += openContra;
    const currency = calc?.currency ?? "ZAR";
    if (currency !== "ZAR") continue;
    const charged = calc?.charged_amount_minor ? Number(calc.charged_amount_minor) / 100 : 0;
    const calculated = calc?.calculated_amount_minor
      ? Number(calc.calculated_amount_minor) / 100
      : 0;
    exposureZar += charged;
    recoveryZar += caseRecovery(charged, calculated, openContra + (clockBlockedCase ? 1 : 0)) ?? 0;
    if (openContra > 0 || clockBlockedCase) recoveryBlocked = true;
  }
  return {
    total: (cases ?? []).length,
    openCases,
    contradictions: contradictionCount,
    exposureZar,
    recoveryZar,
    recoveryBlocked,
  };
}

export const getCaseDashboardStats = createServerFn({ method: "GET" })
  .middleware([tenantMiddleware])
  .handler(async ({ context }) => {
    const { data: cases, error } = await context.supabase.from("cases").select("id,status");
    if (error) throw error;
    const ids = (cases ?? []).map((c) => c.id);
    const { data: calcs } = ids.length
      ? await context.supabase
          .from("financial_calculations")
          .select("case_id,calculated_amount_minor,charged_amount_minor,currency")
          .in("case_id", ids)
          .order("created_at", { ascending: false })
      : { data: [] as never[] };
    const { data: contradictions } = ids.length
      ? await context.supabase.from("contradictions").select("case_id,status").in("case_id", ids)
      : { data: [] as never[] };
    const blockedCaseIds = await unresolvedClockSet(context.supabase, ids);
    return computeDashboardStats(cases ?? [], calcs ?? [], contradictions ?? [], blockedCaseIds);
  });

// Register page: keyset cursor + optional server-side search over the same four
// fields the client filter used (reference_no, vessel_name, container_no, port_code).
const registerPageInput = z
  .object({
    q: z.string().max(120).optional(),
    limit: z.number().int().min(1).max(200).default(100),
    cursor: z.object({ created_at: z.string(), id: z.string() }).optional(),
  })
  .optional();

// PostgREST or-filter for the search term; characters that are syntax in an
// or() expression are stripped so user input cannot break the filter.
export function caseSearchOrFilter(q: string): string {
  const t = q
    .replace(/[%,()\\.]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  const p = `%${t}%`;
  return `reference_no.ilike.${p},vessel_name.ilike.${p},container_no.ilike.${p},port_code.ilike.${p}`;
}

export const getCaseRegisterPage = createServerFn({ method: "GET" })
  .validator(registerPageInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    const limit = data?.limit ?? 100;
    let query = context.supabase
      .from("cases")
      .select("*")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);
    if (data?.q?.trim()) query = query.or(caseSearchOrFilter(data.q));
    if (data?.cursor)
      query = query.or(
        `created_at.lt.${data.cursor.created_at},and(created_at.eq.${data.cursor.created_at},id.lt.${data.cursor.id})`,
      );
    const { data: rows, error } = await query;
    if (error) throw error;
    const page = (rows ?? []).slice(0, limit);
    const nextCursor =
      (rows ?? []).length > limit && page.length
        ? { created_at: page[page.length - 1].created_at, id: page[page.length - 1].id }
        : null;
    return { rows: await enrichCaseRows(context.supabase, page), nextCursor };
  });

export const getCase = createServerFn({ method: "GET" })
  .validator(idInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("cases")
      .select("*")
      .eq("id", data.caseId)
      .maybeSingle();
    if (error) throw error;
    return row;
  });

export const createCase = createServerFn({ method: "POST" })
  .validator(
    z.object({
      referenceNo: z.string().min(3).max(80),
      vesselName: z.string().optional(),
      voyageNo: z.string().optional(),
      containerNo: z.string().optional(),
      portCode: z.string().optional(),
    }),
  )
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const { data: row, error } = await context.supabase
      .from("cases")
      .insert({
        tenant_id: context.tenantId,
        reference_no: data.referenceNo,
        vessel_name: data.vesselName || null,
        voyage_no: data.voyageNo || null,
        container_no: data.containerNo || null,
        port_code: data.portCode || null,
        created_by: context.user.id,
      })
      .select("*")
      .single();
    if (error) throw error;

    await context.supabase.from("audit_log").insert({
      tenant_id: context.tenantId,
      case_id: row.id,
      actor_user_id: context.user.id,
      action: "CASE_CREATED",
      entity_type: "case",
      entity_id: row.id,
      payload: { reference_no: row.reference_no },
    });
    return row;
  });

export const getCaseWorkspace = createServerFn({ method: "GET" })
  .validator(idInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    const db = context.supabase;
    const [caseRow, documents, claims, contradictions, timeline, observations, calcs, packs] =
      await Promise.all([
        db.from("cases").select("*").eq("id", data.caseId).maybeSingle(),
        db
          .from("documents")
          .select("*")
          .eq("case_id", data.caseId)
          .order("uploaded_at", { ascending: false }),
        db
          .from("extracted_claims")
          .select("*")
          .eq("case_id", data.caseId)
          .order("created_at", { ascending: true }),
        db
          .from("contradictions")
          .select("*")
          .eq("case_id", data.caseId)
          .order("created_at", { ascending: false }),
        db
          .from("timeline_events")
          .select("*")
          .eq("case_id", data.caseId)
          .order("timestamp", { ascending: true }),
        db
          .from("external_observations")
          .select("*")
          .eq("case_id", data.caseId)
          .order("observed_at", { ascending: true }),
        db
          .from("financial_calculations")
          .select("*")
          .eq("case_id", data.caseId)
          .order("created_at", { ascending: false }),
        db
          .from("evidence_packs")
          .select("id,version,sha256_hash,status,approved_by,generated_at")
          .eq("case_id", data.caseId)
          .order("version", { ascending: false }),
      ]);
    for (const item of [
      caseRow,
      documents,
      claims,
      contradictions,
      timeline,
      observations,
      calcs,
      packs,
    ])
      if (item.error) throw item.error;
    return {
      tenantId: context.tenantId,
      clockBlocked: await clockBlocked(db, data.caseId),
      case: caseRow.data,
      documents: documents.data ?? [],
      claims: claims.data ?? [],
      contradictions: contradictions.data ?? [],
      timeline: timeline.data ?? [],
      observations: observations.data ?? [],
      calculations: calcs.data ?? [],
      packs: packs.data ?? [],
    };
  });

export const getEvidencePackPayload = createServerFn({ method: "GET" })
  .validator(z.object({ packId: z.string().uuid() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    // Pack payloads can reach ~20MB each, so they load one at a time on demand
    // instead of riding along with every workspace load.
    const { data: pack, error } = await context.supabase
      .from("evidence_packs")
      .select("id,case_id,version,sha256_hash,status,approved_by,generated_at,pack_payload")
      .eq("id", data.packId)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!pack) throw new Error("PACK_NOT_FOUND");
    return pack;
  });

// Upload admission controls (docs/UPLOAD-BACKPRESSURE.md, migration
// 20261025220000). Defaults are code; the owner re-binds or disables per
// workspace from the admin panel, and re-binds globally via env without a
// code change.
const UPLOAD_TENANT_CONCURRENCY_DEFAULT = 3;
const UPLOAD_GLOBAL_CONCURRENCY_DEFAULT = 25;
const UPLOAD_SLOT_TTL_DEFAULT_SECONDS = 300;
function uploadTenantConcurrency(): number {
  return (
    parseUploadConcurrency(process.env.CLAIM_UPLOAD_TENANT_CONCURRENCY) ??
    UPLOAD_TENANT_CONCURRENCY_DEFAULT
  );
}
function uploadGlobalConcurrency(): number {
  return (
    parseUploadConcurrency(process.env.CLAIM_UPLOAD_GLOBAL_CONCURRENCY) ??
    UPLOAD_GLOBAL_CONCURRENCY_DEFAULT
  );
}
function uploadSlotTtlSeconds(): number {
  return parseUploadSlotTtl(
    process.env.CLAIM_UPLOAD_SLOT_TTL_SECONDS,
    UPLOAD_SLOT_TTL_DEFAULT_SECONDS,
  );
}

/** Cooperative pre-upload admission: the client acquires before the storage
 * PUT so honest clients never start an upload the server cannot absorb.
 * NULL leaseId = at cap. Fails CLOSED when enforcement is unavailable: an
 * admission check that cannot run is never represented as a bounded upload. */
export const acquireUploadSlot = createServerFn({ method: "POST" })
  .validator(z.object({}))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const { data: lease, error } = await context.supabase.rpc("acquire_upload_slot", {
      p_tenant_id: context.tenantId,
      p_tenant_max: uploadTenantConcurrency(),
      p_global_max: uploadGlobalConcurrency(),
      p_ttl_seconds: uploadSlotTtlSeconds(),
    });
    if (error) {
      if (error.code === "PGRST202" || error.code === "42883")
        throw new Error("UPLOAD_ADMISSION_UNAVAILABLE");
      throw error;
    }
    void data;
    return { leaseId: lease ?? null };
  });

/** Client-side lease release for the path where registerDocument is never
 * reached (storage PUT failed). Server-side registration releases its own
 * lease; the TTL backstops everything else. */
export const releaseUploadSlot = createServerFn({ method: "POST" })
  .validator(z.object({ leaseId: z.string().uuid() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const { error } = await context.supabase.rpc("release_upload_slot", {
      p_lease_id: data.leaseId,
    });
    if (error && error.code !== "PGRST202" && error.code !== "42883") throw error;
    return { released: true };
  });

export const registerDocument = createServerFn({ method: "POST" })
  .validator(
    z.object({
      caseId: z.string().uuid(),
      filePath: z.string().min(5),
      name: z.string().min(1),
      fileType: z.string().min(1),
      sourceParty: z.string().trim().min(2).max(200),
      leaseId: z.string().uuid(),
    }),
  )
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    // Registration-time enforcement of the admission lease: a registration
    // without a live lease is refused even if a client skipped acquire.
    // The lease is released exactly once, when this handler settles.
    try {
      const { data: leaseOk, error: leaseError } = await context.supabase.rpc(
        "verify_upload_lease",
        {
          p_lease_id: data.leaseId,
          p_tenant_id: context.tenantId,
          p_ttl_seconds: uploadSlotTtlSeconds(),
        },
      );
      if (leaseError) {
        if (leaseError.code === "PGRST202" || leaseError.code === "42883")
          throw new Error("UPLOAD_ADMISSION_UNAVAILABLE");
        throw leaseError;
      }
      if (!leaseOk) throw new Error("UPLOAD_SLOT_EXPIRED");
      const { data: ownedCase } = await context.supabase
        .from("cases")
        .select("id")
        .eq("id", data.caseId)
        .eq("tenant_id", context.tenantId)
        .maybeSingle();
      if (!ownedCase) throw new Error("CASE_NOT_FOUND");
      const expectedPrefix = context.tenantId + "/" + data.caseId + "/";
      if (!data.filePath.startsWith(expectedPrefix)) throw new Error("INVALID_STORAGE_PATH");

      const { data: blob, error: downloadError } = await context.supabase.storage
        .from("case-documents")
        .download(data.filePath);
      if (downloadError || !blob) throw downloadError ?? new Error("DOCUMENT_DOWNLOAD_FAILED");

      assertDocumentSize(blob.size);
      const sha256 = await sha256Hex(await blob.arrayBuffer());

      // Sequential-retry idempotency: the same content re-uploaded within the
      // window returns the already-registered row, and the duplicate object
      // uploaded with this attempt is removed again. This does NOT close the
      // concurrent-same-content race - that needs the partial unique index
      // (owner-gated migration, docs/UPLOAD-BACKPRESSURE.md).
      // Cleanup deletes ONLY an object no documents row references, so a
      // filePath pointing at the canonical (or any registered) object is never
      // deleted. The reference check runs through the service role across ALL
      // tenants: a tenant-scoped RLS query is blind to another tenant's row
      // pointing at the same object. An UNKNOWN reference-check outcome (query
      // error) means NO delete - the object is kept and the failure is
      // retained. The check and the delete are still not atomic (TOCTOU) until
      // the owner-gated unique index provides committed-row atomicity; until
      // then the check errs toward keeping the object.
      // Cleanup uses the service-role storage client because tenant-JWT
      // per-object DELETE is denied at the storage layer
      // (docs/DB-OPERATIONS.md). Cleanup failures are retained in app_errors
      // (owner-visible error log) and logged, never hidden; a failed cleanup
      // leaves an orphaned object but never a wrong row.
      const reportCleanupFailure = async (message: string, cause: unknown) => {
        console.error(message, cause);
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin.from("app_errors").insert({
            route: "registerDocument",
            message: (
              message +
              ": " +
              (cause instanceof Error ? cause.message : String(cause))
            ).slice(0, 2000),
            source: "server",
          });
        } catch (retentionError) {
          console.error("upload-cleanup: error retention failed", retentionError);
        }
      };
      const removeUnreferencedObject = async () => {
        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: refs, error: refError } = await supabaseAdmin
            .from("documents")
            .select("id")
            .eq("file_path", data.filePath)
            .limit(1);
          if (refError) {
            await reportCleanupFailure(
              "upload-cleanup: reference check failed, object kept",
              refError,
            );
            return;
          }
          if (refs?.length) return;
          const { error: removeError } = await supabaseAdmin.storage
            .from("case-documents")
            .remove([data.filePath]);
          if (removeError)
            await reportCleanupFailure("upload-cleanup: storage remove failed", removeError);
        } catch (cleanupError) {
          await reportCleanupFailure(
            "upload-cleanup: unexpected failure, object kept",
            cleanupError,
          );
        }
      };
      const { data: existing } = await context.supabase
        .from("documents")
        .select("*")
        .eq("tenant_id", context.tenantId)
        .eq("case_id", data.caseId)
        .eq("sha256_hash", sha256)
        .gte("created_at", new Date(Date.now() - UPLOAD_IDEMPOTENCY_WINDOW_MS).toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing) {
        await removeUnreferencedObject();
        return existing;
      }

      const { data: row, error } = await context.supabase
        .from("documents")
        .insert({
          tenant_id: context.tenantId,
          case_id: data.caseId,
          name: data.name,
          file_path: data.filePath,
          file_type: data.fileType,
          sha256_hash: sha256,
          source_party: data.sourceParty || null,
        })
        .select("*")
        .single();

      if (error) {
        // Concurrent same-content upload lost the atomic ownership claim
        // (document_content_ownership trigger, 23505). Return the canonical
        // winner - the earliest registered row for this content, matching the
        // ownership backfill - after reference-checked cleanup of this
        // attempt's own object, exactly like the sequential-idempotent path.
        if (
          (error as { code?: string }).code === "23505" &&
          String((error as { message?: string }).message ?? "").includes("documents_content_unique")
        ) {
          const { data: winner } = await context.supabase
            .from("documents")
            .select("*")
            .eq("tenant_id", context.tenantId)
            .eq("case_id", data.caseId)
            .eq("sha256_hash", sha256)
            .order("uploaded_at", { ascending: true })
            .order("id", { ascending: true })
            .limit(1)
            .maybeSingle();
          await removeUnreferencedObject();
          if (winner) return winner;
          throw error;
        }
        // The insert outcome is ambiguous (the error may follow a lost
        // response): delete only if no row references the object, then surface
        // the failure. A retry re-registers idempotently by content hash.
        await removeUnreferencedObject();
        throw error;
      }
      return row;
    } finally {
      try {
        await context.supabase.rpc("release_upload_slot", { p_lease_id: data.leaseId });
      } catch (releaseError) {
        console.error("upload-admission: lease release failed (TTL backstops)", releaseError);
      }
    }
  });

export const runDocumentExtraction = createServerFn({ method: "POST" })
  .validator(
    z.object({
      documentId: z.string().uuid(),
      caseId: z.string().uuid(),
      noAi: z.boolean().optional(),
      freeDataClass: z.literal("public_synthetic").optional(),
    }),
  )
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    return extractDocumentClaimsForPath({
      ...data,
      tenantId: context.tenantId,
      supabase: context.supabase,
      userId: context.user.id,
    });
  });

export const reviewClaim = createServerFn({ method: "POST" })
  .validator(
    z.object({
      claimId: z.string().uuid(),
      caseId: z.string().uuid(),
      decision: z.enum(["VERIFIED", "DISPUTED"]),
    }),
  )
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const { data: row, error } = await context.supabase
      .from("extracted_claims")
      .update({
        status: data.decision,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.claimId)
      .eq("case_id", data.caseId)
      .select("*")
      .single();
    if (error) throw error;

    await context.supabase.from("audit_log").insert({
      tenant_id: context.tenantId,
      case_id: data.caseId,
      actor_user_id: context.user.id,
      action: "CLAIM_REVIEWED",
      entity_type: "extracted_claim",
      entity_id: data.claimId,
      payload: { decision: data.decision },
    });
    return row;
  });

export const resolveContradiction = createServerFn({ method: "POST" })
  .validator(
    z.object({
      contradictionId: z.string().uuid(),
      caseId: z.string().uuid(),
      explanation: z.string().trim().min(10).max(4000),
      supportingDocumentId: z.string().uuid(),
      evidenceReference: z.string().trim().min(3).max(1000),
    }),
  )
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    // Database trigger validates same-case evidence and records the audit atomically.
    const { data: row, error } = await context.supabase
      .from("contradictions")
      .update({
        status: "RESOLVED",
        resolution_note: data.explanation,
        resolution_document_id: data.supportingDocumentId,
        resolution_evidence_reference: data.evidenceReference,
      })
      .eq("id", data.contradictionId)
      .eq("case_id", data.caseId)
      .eq("status", "FLAGGED")
      .select("*")
      .single();
    if (error) throw error;
    return row;
  });

export const corroborateCase = createServerFn({ method: "POST" })
  .validator(z.object({ caseId: z.string().uuid(), start: z.string(), end: z.string() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    // Throttle: each run fans out to paid/external AIS, satellite and weather APIs.
    const throttleSince = new Date(Date.now() - 60_000).toISOString();
    const { count: recentRuns } = await context.supabase
      .from("audit_log")
      .select("id", { head: true, count: "exact" })
      .eq("tenant_id", context.tenantId)
      .eq("action", "CASE_CORROBORATED")
      .gte("created_at", throttleSince);
    if ((recentRuns ?? 0) >= 5) throw new Error("CORROBORATE_RATE_LIMITED");
    const { data: row, error } = await context.supabase
      .from("cases")
      .select("vessel_name,port_code")
      .eq("id", data.caseId)
      .single();
    if (error || !row) throw error ?? new Error("CASE_NOT_FOUND");

    const center = resolvePortCenter(row.port_code);
    const bbox = buildAisBoundingBox(center, 35);
    const [ais, scenes, weather] = await Promise.all([
      fetchAisSnapshot({ vesselName: row.vessel_name ?? undefined, bbox }),
      querySentinelScenes({ bbox, start: data.start, end: data.end, limit: 12 }),
      fetchPortConditions({
        latitude: center[0],
        longitude: center[1],
        start: data.start,
        end: data.end,
      }),
    ]);

    const observations = [
      ...ais.map((x) => ({
        source: x.source,
        observation_type: "AIS_POSITION",
        observed_at: x.observedAt,
        latitude: x.latitude,
        longitude: x.longitude,
        payload: x as unknown as Json,
        confidence: 0.8,
        limitation:
          "AIS corroborates reported vessel position; it does not prove contractual liability.",
      })),
      // Scenes without an acquisition time cannot anchor the NOT NULL observed_at
      // column, so they are excluded rather than failing the insert at runtime.
      ...scenes
        .filter((x): x is typeof x & { acquiredAt: string } => x.acquiredAt !== null)
        .map((x) => ({
          source: "Copernicus Sentinel Data Space",
          observation_type: x.sensor === "SENTINEL-1" ? "SENTINEL_1_SCENE" : "SENTINEL_2_SCENE",
          observed_at: x.acquiredAt,
          latitude: x.bbox ? (x.bbox[1] + x.bbox[3]) / 2 : null,
          longitude: x.bbox ? (x.bbox[0] + x.bbox[2]) / 2 : null,
          payload: x as unknown as Json,
          confidence: 0.7,
          limitation:
            "Scene metadata corroborates spatial/temporal coverage; imagery requires human inspection before shipment-specific conclusions.",
        })),
      ...weather.slice(0, 48).map((x) => ({
        source: x.source,
        observation_type: "MARINE_WEATHER",
        observed_at: x.time,
        latitude: center[0],
        longitude: center[1],
        payload: x as unknown as Json,
        confidence: 0.6,
        limitation:
          "Weather is contextual evidence and does not establish delay responsibility by itself.",
      })),
    ];

    await context.supabase.from("audit_log").insert({
      tenant_id: context.tenantId,
      case_id: data.caseId,
      actor_user_id: context.user.id,
      action: "CASE_CORROBORATED",
      entity_type: "case",
      entity_id: data.caseId,
      payload: { observations: observations.length },
    });
    if (observations.length) {
      const { error: insertError } = await context.supabase
        .from("external_observations")
        .insert(
          observations.map((x) => ({ tenant_id: context.tenantId, case_id: data.caseId, ...x })),
        );
      if (insertError) throw insertError;
    }

    const aisEvents = ais.slice(0, 50).map((x) => ({
      tenant_id: context.tenantId,
      case_id: data.caseId,
      timestamp: x.observedAt,
      title: (x.vesselName ?? row.vessel_name ?? "Vessel") + " AIS position",
      source: x.source,
      evidence_class: "INDEPENDENT_OBSERVATION",
      nature: "OBSERVED",
      coordinates: { lat: x.latitude, lon: x.longitude },
      provenance_id: null,
    }));

    if (aisEvents.length) {
      const { error: timelineError } = await context.supabase
        .from("timeline_events")
        .insert(aisEvents);
      if (timelineError) throw timelineError;
    }

    return { ais: ais.length, scenes: scenes.length, weather: weather.length };
  });

export const calculateCaseDemurrage = createServerFn({ method: "POST" })
  .validator(
    z.object({
      caseId: z.string().uuid(),
      start: z.string(),
      release: z.string(),
      freeDays: z.number().nonnegative(),
      units: z.number().positive(),
      currency: z.literal("ZAR"),
      chargedAmount: z.number().nonnegative().optional(),
      tieredRates: z
        .array(
          z.object({
            fromDay: z.number().int().positive(),
            toDay: z.number().int().positive().optional(),
            dailyRate: z.number().nonnegative(),
          }),
        )
        .min(1),
      ruleVersion: z.string().min(1),
    }),
  )
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const { data: flaggedRows, error: flaggedError } = await context.supabase
      .from("contradictions")
      .select("id")
      .eq("case_id", data.caseId)
      .eq("status", "FLAGGED")
      .limit(1);
    if (flaggedError) throw flaggedError;
    if (flaggedRows?.length) throw new Error("BLOCKED: resolve open contradictions first.");
    await assertClockGate(context.supabase, data.caseId);
    const result = calculateDemurrage(data);
    const calculatedMinor = Math.round(result.total * 100);
    const chargedMinor = data.chargedAmount == null ? null : Math.round(data.chargedAmount * 100);
    const varianceMinor = chargedMinor == null ? null : chargedMinor - calculatedMinor;

    const { error: ruleError } = await context.supabase.from("commercial_rules").upsert(
      {
        tenant_id: context.tenantId,
        name: "DEMURRAGE",
        rule_version: data.ruleVersion,
        rule_type: "DEMURRAGE",
        currency: data.currency.toUpperCase(),
        payload: { freeDays: data.freeDays, units: data.units, tieredRates: data.tieredRates },
        active: true,
      },
      { onConflict: "tenant_id,name,rule_version" },
    );
    if (ruleError) throw ruleError;

    const { data: row, error } = await context.supabase
      .from("financial_calculations")
      .insert({
        tenant_id: context.tenantId,
        case_id: data.caseId,
        calculation_type: "DEMURRAGE",
        rule_version: data.ruleVersion,
        input_payload: data,
        result_payload: result,
        calculated_amount_minor: calculatedMinor,
        charged_amount_minor: chargedMinor,
        variance_minor: varianceMinor,
        currency: data.currency.toUpperCase(),
        created_by: context.user.id,
      })
      .select("*")
      .single();
    if (error) throw error;
    return row;
  });

export const generateEvidencePack = createServerFn({ method: "POST" })
  .validator(idInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const db = context.supabase;
    const [
      c,
      docs,
      claims,
      contradictions,
      timeline,
      observations,
      calculations,
      existing,
      definitions,
      clocks,
      attributions,
      kpis,
      matches,
      gaps,
      identityReviews,
      clockDecisions,
      countSources,
      countRules,
      countComparisons,
      appointmentLifecycle,
      authorisedImports,
    ] = await Promise.all([
      db.from("cases").select("*").eq("id", data.caseId).single(),
      db
        .from("documents")
        .select("*")
        .eq("case_id", data.caseId)
        .order("uploaded_at", { ascending: true }),
      db
        .from("extracted_claims")
        .select("*")
        .eq("case_id", data.caseId)
        .order("created_at", { ascending: true }),
      db
        .from("contradictions")
        .select("*")
        .eq("case_id", data.caseId)
        .order("created_at", { ascending: true }),
      db
        .from("timeline_events")
        .select("*")
        .eq("case_id", data.caseId)
        .order("timestamp", { ascending: true }),
      db
        .from("external_observations")
        .select("*")
        .eq("case_id", data.caseId)
        .order("observed_at", { ascending: true }),
      db
        .from("financial_calculations")
        .select("*")
        .eq("case_id", data.caseId)
        .order("created_at", { ascending: true }),
      db
        .from("evidence_packs")
        .select("version,status")
        .eq("case_id", data.caseId)
        .order("version", { ascending: false }),
      db
        .from("operational_definitions")
        .select("*")
        .eq("case_id", data.caseId)
        .order("created_at", { ascending: true }),
      db
        .from("operational_clocks")
        .select("*")
        .eq("case_id", data.caseId)
        .order("created_at", { ascending: true }),
      db
        .from("appointment_attributions")
        .select("*")
        .eq("case_id", data.caseId)
        .order("created_at", { ascending: true }),
      db
        .from("kpi_definitions")
        .select("*")
        .eq("case_id", data.caseId)
        .order("created_at", { ascending: true }),
      db
        .from("cross_party_matches")
        .select("*")
        .eq("case_id", data.caseId)
        .order("created_at", { ascending: true }),
      db
        .from("evidence_gap_entries")
        .select("*")
        .eq("case_id", data.caseId)
        .order("created_at", { ascending: true }),
      db
        .from("cross_party_match_reviews")
        .select("*")
        .eq("case_id", data.caseId)
        .order("created_at", { ascending: true }),
      db
        .from("clock_reconciliations")
        .select("*")
        .eq("case_id", data.caseId)
        .order("created_at", { ascending: true }),
      db
        .from("count_source_records")
        .select("*")
        .eq("case_id", data.caseId)
        .order("created_at", { ascending: true }),
      db
        .from("count_rule_versions")
        .select("*")
        .eq("case_id", data.caseId)
        .order("created_at", { ascending: true }),
      db
        .from("count_comparison_definitions")
        .select("*")
        .eq("case_id", data.caseId)
        .order("created_at", { ascending: true }),
      db
        .from("appointment_lifecycle")
        .select("*")
        .eq("case_id", data.caseId)
        .order("created_at", { ascending: true }),
      db
        .from("authorised_imports")
        .select("*")
        .eq("case_id", data.caseId)
        .order("created_at", { ascending: true }),
    ]);
    for (const x of [
      c,
      docs,
      claims,
      contradictions,
      timeline,
      observations,
      calculations,
      existing,
      definitions,
      clocks,
      attributions,
      kpis,
      matches,
      gaps,
      identityReviews,
      clockDecisions,
      countSources,
      countRules,
      countComparisons,
      appointmentLifecycle,
      authorisedImports,
    ])
      if (x.error) throw x.error;

    const unresolved = (contradictions.data ?? []).filter((x) => x.status === "FLAGGED").length;
    if (unresolved > 0)
      throw new Error("Resolve the flagged contradictions before generating an evidence pack.");
    await assertClockGate(db, data.caseId);

    const version = ((existing.data?.[0]?.version as number | undefined) ?? 0) + 1;
    const payload = {
      generatedAt: new Date().toISOString(),
      version,
      case: c.data,
      documents: docs.data ?? [],
      operationalDefinitions: definitions.data ?? [],
      operationalClocks: clocks.data ?? [],
      appointmentAttributions: attributions.data ?? [],
      kpiDefinitions: kpis.data ?? [],
      crossPartyMatches: matches.data ?? [],
      evidenceGapHistory: gaps.data ?? [],
      eventIdentityReviews: identityReviews.data ?? [],
      clockReconciliations: clockDecisions.data ?? [],
      countSourceRecords: countSources.data ?? [],
      countRuleVersions: countRules.data ?? [],
      countComparisons: countComparisons.data ?? [],
      appointmentLifecycle: appointmentLifecycle.data ?? [],
      authorisedImports: authorisedImports.data ?? [],
      countEngineVersion: "1",
      verifiedClaims: (claims.data ?? []).filter((x) => x.status === "VERIFIED"),
      claims: claims.data ?? [],
      contradictions: contradictions.data ?? [],
      timeline: timeline.data ?? [],
      externalObservations: observations.data ?? [],
      financialCalculations: calculations.data ?? [],
      approvals: [],
      truthRule:
        "Public and independent observations are corroboration unless the source directly proves the event. Inference remains inference until human review.",
    };
    const { data: packResult, error: persistError } = await db.rpc("persist_evidence_pack_atomic", {
      _case_id: data.caseId,
      _canonical: stableCanonical(payload),
    });
    if (persistError) throw persistError;
    const pack = Array.isArray(packResult) ? packResult[0] : packResult;
    if (!pack?.id) throw new Error("Atomic evidence-pack persistence returned no pack.");
    const hash = pack.sha256_hash as string;

    const summary = [
      "# CargoIQ Investigation " + (c.data?.reference_no ?? ""),
      "",
      "**Case:** " + (c.data?.reference_no ?? "—"),
      "**Vessel:** " + (c.data?.vessel_name ?? "—"),
      "**Port:** " + (c.data?.port_code ?? "—"),
      "**Evidence pack:** v" + version,
      "**SHA-256:** " + hash,
      "",
      "## Timeline",
      ...(timeline.data ?? []).map(
        (e) => "- " + e.timestamp + " — " + e.title + " [" + e.nature + "] — " + e.source,
      ),
      "",
      "## Count source records and executable mappings (engine v1)",
      ...(countSources.data ?? []).map(
        (x) =>
          "- " +
          x.party +
          " / " +
          x.physical_reference +
          " v" +
          x.version +
          ": " +
          x.quantity +
          " " +
          x.basis +
          "; evidence " +
          x.source_document_id +
          ", " +
          x.source_reference,
      ),
      ...(countRules.data ?? []).map(
        (x) =>
          "- Rule " +
          x.name +
          " v" +
          x.version +
          ": " +
          x.input_basis +
          " -> " +
          x.output_unit +
          ", " +
          x.calculation +
          " x " +
          x.numerator +
          "/" +
          x.denominator +
          " [" +
          x.acceptance +
          "]",
      ),
      ...(countComparisons.data ?? []).map(
        (x) =>
          "- Common scope " +
          x.name +
          " v" +
          x.version +
          ": " +
          x.physical_references.join(", ") +
          "; mappings " +
          x.rule_ids.join(", ") +
          "; duration definition " +
          (x.kpi_definition_id ?? "none") +
          " [" +
          x.acceptance +
          "]",
      ),
      "",
      "## Appointment lifecycle and human causal review",
      ...(appointmentLifecycle.data ?? []).map(
        (x) =>
          "- " +
          x.appointment_reference +
          " / " +
          x.record_type +
          " v" +
          x.version +
          ": " +
          x.explanation +
          "; issuer " +
          x.issuer +
          "; claim target " +
          (x.claim_target || "not assessed") +
          " [" +
          x.outcome +
          "]; terms " +
          x.terms_reference,
      ),
      "",
      "## Authorised export provenance (permission is an operator assertion)",
      ...(authorisedImports.data ?? []).map(
        (x) =>
          "- " +
          x.dataset +
          " / " +
          x.row_count +
          " rows; exported " +
          x.exported_at +
          "; SHA256 " +
          x.raw_sha256 +
          "; authority basis " +
          x.authorization_basis,
      ),
      "",
      "## Operational definitions",
      ...(definitions.data ?? []).map(
        (x) =>
          "- " +
          x.party +
          " / " +
          x.metric +
          " v" +
          x.version +
          ": " +
          x.unit +
          " [" +
          x.acceptance +
          "] - " +
          x.rule +
          " (source " +
          x.source_document_id +
          ", " +
          x.source_reference +
          ")",
      ),
      "",
      "## Clock evidence and appointment attribution",
      ...(clocks.data ?? []).map(
        (x) =>
          "- " +
          x.physical_reference +
          " " +
          x.kind +
          ": " +
          x.timestamp_original +
          " (" +
          x.time_zone +
          ") - source " +
          x.source_party +
          ", " +
          x.source_document_id +
          ", " +
          x.source_reference,
      ),
      ...(attributions.data ?? []).map(
        (x) =>
          "- Appointment source " +
          x.appointment_clock_id +
          ": claimant " +
          x.claimant +
          ", target " +
          x.claim_target +
          ", assertion " +
          x.assertion +
          " - evidence " +
          x.source_document_id +
          ", " +
          x.source_reference,
      ),
      "",
      "## KPI definitions and benchmarks",
      ...(kpis.data ?? []).map(
        (x) =>
          "- " +
          x.party +
          " / " +
          x.name +
          " v" +
          x.version +
          ": " +
          x.start_kind +
          " to " +
          x.end_kind +
          " [" +
          x.acceptance +
          "] - scope " +
          x.physical_reference +
          ", benchmark " +
          (x.benchmark_hours ?? "not supplied") +
          "h; " +
          x.benchmark_basis,
      ),
      "",
      "## Cross-party physical-event matches",
      ...(matches.data ?? []).map(
        (x) =>
          "- " +
          x.event_reference +
          ": " +
          x.result +
          ", claims " +
          x.claim_a_id +
          " / " +
          x.claim_b_id +
          ", rationale " +
          x.rationale,
      ),
      "",
      "## Match review history (retractions and reaffirmations)",
      ...(identityReviews.data ?? []).map(
        (x) =>
          "- match " +
          x.match_id +
          " v" +
          x.version +
          ": " +
          x.status +
          " - " +
          x.explanation +
          " (evidence " +
          x.source_document_id +
          ", " +
          x.source_reference +
          ")",
      ),
      "",
      "## Evidenced clock reconciliation decisions",
      ...(clockDecisions.data ?? []).map(
        (x) =>
          "- " +
          x.physical_reference +
          " / " +
          x.kind +
          " v" +
          x.version +
          ": selected " +
          x.selected_clock_id +
          "; considered " +
          x.considered_clock_ids.join(", ") +
          " - " +
          x.explanation +
          " (evidence " +
          x.source_document_id +
          ", " +
          x.source_reference +
          ")",
      ),
      "",
      "## Required evidence and gaps (history, not proof of non-occurrence)",
      ...(gaps.data ?? []).map(
        (x) =>
          "- " +
          x.physical_reference +
          " / " +
          x.required_event +
          " v" +
          x.version +
          ": " +
          x.status +
          " - " +
          x.explanation,
      ),
      "",

      "## Contradictions",
      ...(contradictions.data ?? []).map((x) => "- " + x.title + ": " + x.description),
      "",
      "## Financial calculations",
      ...(calculations.data ?? []).map(
        (x) =>
          "- " +
          x.calculation_type +
          " " +
          (x.currency ?? "") +
          ": calculated=" +
          (x.calculated_amount_minor ?? "—") +
          " minor, charged=" +
          (x.charged_amount_minor ?? "—") +
          " minor, variance=" +
          (x.variance_minor ?? "—"),
      ),
      "",
      "## Limitations",
      "- AIS can contain gaps, spoofing or stale identity data.",
      "- Satellite scene availability is not the same as cargo-level proof.",
      "- Weather provides context and does not establish responsibility by itself.",
      "- Human review is required for disputed claims and external action.",
    ].join("\n");

    return { pack, payload, hash, summary };
  });

export const approveEvidencePack = createServerFn({ method: "POST" })
  .validator(z.object({ caseId: z.string().uuid(), packId: z.string().uuid() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const { data: flagged, error: contradictionError } = await context.supabase
      .from("contradictions")
      .select("id")
      .eq("case_id", data.caseId)
      .eq("status", "FLAGGED")
      .limit(1);
    if (contradictionError) throw contradictionError;
    if (flagged?.length)
      throw new Error("Resolve the flagged contradictions before generating an evidence pack.");
    await assertClockGate(context.supabase, data.caseId);

    const { data: packResult, error } = await context.supabase.rpc("approve_evidence_pack_atomic", {
      _case_id: data.caseId,
      _pack_id: data.packId,
    });
    if (error) throw error;
    const pack = Array.isArray(packResult) ? packResult[0] : packResult;
    if (!pack?.id) throw new Error("Atomic evidence-pack approval returned no pack.");

    return pack;
  });
