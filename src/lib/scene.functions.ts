import { requireIntegratedFeatureReady } from "@/lib/integrated-feature-gate";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { tenantMiddleware } from "@/lib/auth-middleware";
import {
  assertSceneTransition,
  requestConversion,
  sceneAssetInput,
  validateTilesetUrl,
} from "@/lib/scene";

// Entity audit is written atomically by the proposed database triggers.
// Deploy only with docs/proposals/feature_atomic_audit.sql after approval.

export const listSceneAssets = createServerFn({ method: "GET" })
  .validator(z.object({ caseId: z.string().uuid().optional() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    await requireIntegratedFeatureReady(context.supabase);
    let q = context.supabase
      .from("scene_assets")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .order("created_at", { ascending: false });
    if (data.caseId) q = q.eq("case_id", data.caseId);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

export const registerSceneAsset = createServerFn({ method: "POST" })
  .validator(sceneAssetInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    await requireIntegratedFeatureReady(context.supabase);
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const [events, documents] = await Promise.all([
      data.eventIds.length
        ? context.supabase
            .from("timeline_events")
            .select("id,case_id")
            .eq("tenant_id", context.tenantId)
            .in("id", data.eventIds)
        : Promise.resolve({ data: [], error: null }),
      data.documentIds.length
        ? context.supabase
            .from("documents")
            .select("id,case_id")
            .eq("tenant_id", context.tenantId)
            .in("id", data.documentIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (events.error) throw events.error;
    if (documents.error) throw documents.error;
    for (const [rows, ids] of [
      [events.data, data.eventIds],
      [documents.data, data.documentIds],
    ] as const) {
      if (
        new Set(rows?.map((r) => r.id)).size !== new Set(ids).size ||
        rows?.some((r) => !data.caseId || r.case_id !== data.caseId)
      )
        throw new Error("SCENE_LINK_NOT_IN_CASE");
    }
    // A URL is a candidate only: syntactic validation is not load/render proof.
    const status = "registered";
    if (data.tilesetUrl) {
      const v = validateTilesetUrl(data.tilesetUrl);
      if (!v.ok) throw new Error("INVALID_TILESET_URL: " + v.reason);
    }
    const { data: row, error } = await context.supabase
      .from("scene_assets")
      .insert({
        tenant_id: context.tenantId,
        case_id: data.caseId ?? null,
        name: data.name,
        source_type: data.sourceType,
        status,
        source_ref: data.sourceRef ?? null,
        acquired_at: data.acquiredAt ?? null,
        tileset_url: data.tilesetUrl ?? null,
        provenance: {
          ...data.provenance,
          caseEventIds: data.eventIds,
          documentIds: data.documentIds,
        } as never,
        created_by: context.user.id,
      })
      .select("*")
      .single();
    if (error) throw error;

    return row;
  });

export const requestSceneConversion = createServerFn({ method: "POST" })
  .validator(z.object({ assetId: z.string().uuid() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    await requireIntegratedFeatureReady(context.supabase);
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const { data: asset, error } = await context.supabase
      .from("scene_assets")
      .select("id,status")
      .eq("id", data.assetId)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    assertSceneTransition(asset.status as never, "queued");
    const result = requestConversion(asset.id);
    // Converter absent: no job is created and no entity mutation/audit is implied.

    return result;
  });

export const setSceneTileset = createServerFn({ method: "POST" })
  .validator(z.object({ assetId: z.string().uuid(), tilesetUrl: z.string().url().max(2000) }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    await requireIntegratedFeatureReady(context.supabase);
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const v = validateTilesetUrl(data.tilesetUrl);
    if (!v.ok) throw new Error("INVALID_TILESET_URL: " + v.reason);
    const { data: asset, error } = await context.supabase
      .from("scene_assets")
      .select("id,status")
      .eq("id", data.assetId)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!asset) throw new Error("ASSET_NOT_FOUND");
    if (!["registered", "failed"].includes(asset.status)) throw new Error("ASSET_NOT_EDITABLE");
    const { data: updated, error: uErr } = await context.supabase
      .from("scene_assets")
      .update({
        tileset_url: data.tilesetUrl,
        status: "registered",
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.assetId)
      .eq("tenant_id", context.tenantId)
      .eq("status", asset.status)
      .select("*")
      .maybeSingle();
    if (!updated && !uErr) throw new Error("RECORD_CHANGED: reload before retrying");
    if (uErr) throw uErr;

    return updated;
  });
