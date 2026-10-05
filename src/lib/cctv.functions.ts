import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { tenantMiddleware } from "@/lib/auth-middleware";
import { cctvEventTitle, defaultCctvLimitation } from "@/lib/cctv-contract";
import { encryptSecret, randomSecret } from "@/lib/cctv-crypto";

const caseInput = z.object({ caseId: z.string().uuid() });
const observationInput = z.object({ caseId: z.string().uuid(), observationId: z.string().uuid() });

async function service() {
  const { getServiceClient, getCctvEncryptionMasterKey } = await import("@/lib/cctv-server");
  return { db: getServiceClient(), masterKey: getCctvEncryptionMasterKey() };
}

async function writeAudit(db: any, tenantId: string, caseId: string | null, userId: string, action: string, targetType: string, targetId: string, payload: Record<string, unknown> = {}) {
  await db.from("audit_log").insert({ tenant_id: tenantId, case_id: caseId, actor_user_id: userId, action, entity_type: targetType, entity_id: targetId, payload });
}

async function assertCase(db: any, tenantId: string, caseId: string) {
  const { data, error } = await db.from("cases").select("id,reference_no").eq("id", caseId).eq("tenant_id", tenantId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("CASE_NOT_FOUND");
  return data;
}

export const listCctvSources = createServerFn({ method: "GET" }).middleware([tenantMiddleware]).handler(async ({ context }) => {
  const { db } = await service();
  const { data, error } = await db.from("cctv_sources").select("id,name,site_location,provider,provider_version,deployment_type,license_status,retention_days,privacy_notes,enabled,created_at,updated_at").eq("tenant_id", context.tenantId).order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
});

export const createCctvSource = createServerFn({ method: "POST" })
  .validator(z.object({
    name: z.string().min(2).max(255),
    siteLocation: z.string().max(255).optional(),
    provider: z.string().max(120).default("Lot Vulture"),
    providerVersion: z.string().max(120).optional(),
    deploymentType: z.string().max(40).default("edge"),
    licenseStatus: z.string().max(60).default("REVIEW"),
    retentionDays: z.number().int().min(1).max(3650).default(30),
    privacyNotes: z.string().max(2000).optional(),
  }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    const { db, masterKey } = await service();
    const ingestSecret = randomSecret(32);
    const encrypted = await encryptSecret(ingestSecret, masterKey);
    const { data: row, error } = await db.from("cctv_sources").insert({
      tenant_id: context.tenantId, name: data.name, site_location: data.siteLocation ?? null,
      provider: data.provider, provider_version: data.providerVersion ?? null,
      deployment_type: data.deploymentType, license_status: data.licenseStatus,
      retention_days: data.retentionDays, privacy_notes: data.privacyNotes ?? null,
      ingest_secret_ciphertext: encrypted, created_by: context.user.id,
    }).select("id,name,site_location,provider,provider_version,deployment_type,license_status,retention_days,privacy_notes,enabled,created_at,updated_at").single();
    if (error) throw error;
    await writeAudit(db, context.tenantId, null, context.user.id, "CCTV_SOURCE_CREATED", "cctv_source", row.id, { provider: data.provider });
    return { source: row, ingestSecret };
  });

export const createCctvCamera = createServerFn({ method: "POST" })
  .validator(z.object({
    sourceId: z.string().uuid(), providerCameraId: z.string().min(1).max(120), displayName: z.string().min(1).max(255),
    manufacturer: z.string().max(120).optional(), streamType: z.string().max(40).optional(),
    installationLocation: z.string().max(255).optional(), latitude: z.number().finite().optional(), longitude: z.number().finite().optional(),
    timezone: z.string().max(80).default("UTC"),
  }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    const { db } = await service();
    const { data: source } = await db.from("cctv_sources").select("id").eq("id", data.sourceId).eq("tenant_id", context.tenantId).maybeSingle();
    if (!source) throw new Error("CCTV_SOURCE_NOT_FOUND");
    const { data: row, error } = await db.from("cctv_cameras").insert({
      tenant_id: context.tenantId, source_id: data.sourceId, provider_camera_id: data.providerCameraId,
      display_name: data.displayName, manufacturer: data.manufacturer ?? null, stream_type: data.streamType ?? null,
      installation_location: data.installationLocation ?? null, latitude: data.latitude ?? null, longitude: data.longitude ?? null, timezone: data.timezone,
    }).select("*").single();
    if (error) throw error;
    await writeAudit(db, context.tenantId, null, context.user.id, "CCTV_CAMERA_CREATED", "cctv_camera", row.id, {});
    return row;
  });

export const getCaseCctv = createServerFn({ method: "GET" })
  .validator(caseInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    const { db } = await service();
    const caseRow = await assertCase(db, context.tenantId, data.caseId);
    const [{ data: linked, error: linkedError }, { data: ready, error: readyError }, { data: sources, error: sourcesError }, { data: cameras, error: camerasError }] = await Promise.all([
      db.from("cctv_observations").select("*").eq("tenant_id", context.tenantId).eq("case_id", data.caseId).order("observed_at", { ascending: true }),
      db.from("cctv_observations").select("*").eq("tenant_id", context.tenantId).is("case_id", null).order("observed_at", { ascending: false }).limit(100),
      db.from("cctv_sources").select("id,name,site_location,provider,provider_version,deployment_type,license_status,retention_days,privacy_notes,enabled").eq("tenant_id", context.tenantId).order("name", { ascending: true }),
      db.from("cctv_cameras").select("id,source_id,provider_camera_id,display_name,manufacturer,stream_type,installation_location,latitude,longitude,timezone,health_status,last_seen_at").eq("tenant_id", context.tenantId).order("display_name", { ascending: true }),
    ]);
    for (const error of [linkedError, readyError, sourcesError, camerasError]) if (error) throw error;
    const linkedIds = (linked ?? []).map((x: any) => x.id);
    const { data: artifacts, error: artifactError } = linkedIds.length
      ? await db.from("cctv_evidence_artifacts").select("id,observation_id,media_type,file_name,byte_size,sha256_hash,captured_at,source_timestamp,retrieved_at,model_name,model_version,processing_version,metadata").eq("tenant_id", context.tenantId).in("observation_id", linkedIds)
      : { data: [], error: null };
    if (artifactError) throw artifactError;
    return { case: caseRow, linked: linked ?? [], ready: ready ?? [], artifacts: artifacts ?? [], sources: sources ?? [], cameras: cameras ?? [] };
  });

export const linkCctvObservation = createServerFn({ method: "POST" })
  .validator(observationInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    const { db } = await service();
    await assertCase(db, context.tenantId, data.caseId);
    const { data: observation, error } = await db.from("cctv_observations").select("*").eq("id", data.observationId).eq("tenant_id", context.tenantId).maybeSingle();
    if (error) throw error;
    if (!observation) throw new Error("CCTV_OBSERVATION_NOT_FOUND");
    if (observation.case_id && observation.case_id !== data.caseId) throw new Error("CCTV_OBSERVATION_ALREADY_LINKED");
    const { data: source } = await db.from("cctv_sources").select("id,name").eq("id", observation.source_id).eq("tenant_id", context.tenantId).maybeSingle();
    const { data: camera } = observation.camera_id ? await db.from("cctv_cameras").select("id,display_name,latitude,longitude").eq("id", observation.camera_id).eq("tenant_id", context.tenantId).maybeSingle() : { data: null as any };
    const { data: zone } = observation.zone_id ? await db.from("cctv_zones").select("id,zone_code,zone_type,semantic_purpose").eq("id", observation.zone_id).eq("tenant_id", context.tenantId).maybeSingle() : { data: null as any };
    const limitation = defaultCctvLimitation();

    const { data: external, error: externalError } = await db.from("external_observations").insert({
      tenant_id: context.tenantId, case_id: data.caseId, source: "CCTV / " + (source?.name ?? "Unknown source"),
      observation_type: observation.event_type, observed_at: observation.observed_at,
      latitude: camera?.latitude ?? null, longitude: camera?.longitude ?? null,
      payload: { cctv_observation_id: observation.id, source_id: observation.source_id, camera_id: observation.camera_id, zone_id: observation.zone_id, event_type: observation.event_type, detected_class: observation.detected_class, confidence: observation.confidence, model_name: observation.model_name, model_version: observation.model_version, processing_version: observation.processing_version, review_status: observation.review_status, evidence_available: observation.evidence_available },
      confidence: observation.confidence, limitation,
    }).select("*").single();
    if (externalError) throw externalError;

    const { data: timelineEvent, error: timelineError } = await db.from("timeline_events").insert({
      tenant_id: context.tenantId, case_id: data.caseId, timestamp: observation.observed_at,
      title: cctvEventTitle(observation.event_type, zone?.zone_code ?? null),
      source: "CCTV / " + (camera?.display_name ?? source?.name ?? "Unknown camera"),
      evidence_class: "INDEPENDENT_OBSERVATION", nature: "OBSERVED",
      coordinates: camera?.latitude != null && camera?.longitude != null ? { lat: camera.latitude, lon: camera.longitude } : null,
      provenance_id: observation.id,
    }).select("*").single();
    if (timelineError) throw timelineError;

    const { data: updated, error: updateError } = await db.from("cctv_observations").update({
      case_id: data.caseId, external_observation_id: external.id, timeline_event_id: timelineEvent.id,
    }).eq("id", observation.id).eq("tenant_id", context.tenantId).select("*").single();
    if (updateError) throw updateError;
    await writeAudit(db, context.tenantId, data.caseId, context.user.id, "CCTV_OBSERVATION_LINKED", "cctv_observation", observation.id, { external_observation_id: external.id, timeline_event_id: timelineEvent.id });
    return updated;
  });

export const reviewCctvObservation = createServerFn({ method: "POST" })
  .validator(observationInput.extend({ decision: z.enum(["CONFIRMED", "UNCERTAIN", "REJECTED"]), note: z.string().max(2000).optional() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    const { db } = await service();
    await assertCase(db, context.tenantId, data.caseId);
    const { data: observation, error } = await db.from("cctv_observations").select("*").eq("id", data.observationId).eq("tenant_id", context.tenantId).eq("case_id", data.caseId).maybeSingle();
    if (error) throw error;
    if (!observation) throw new Error("CCTV_OBSERVATION_NOT_FOUND");
    const { data: updated, error: updateError } = await db.from("cctv_observations").update({
      review_status: data.decision, review_note: data.note ?? null, reviewed_by: context.user.id, reviewed_at: new Date().toISOString(),
    }).eq("id", observation.id).eq("tenant_id", context.tenantId).select("*").single();
    if (updateError) throw updateError;
    await writeAudit(db, context.tenantId, data.caseId, context.user.id, "CCTV_OBSERVATION_REVIEWED", "cctv_observation", observation.id, { decision: data.decision });
    return updated;
  });

export const getCctvEvidenceUrl = createServerFn({ method: "GET" })
  .validator(z.object({ caseId: z.string().uuid(), artifactId: z.string().uuid() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    const { db } = await service();
    await assertCase(db, context.tenantId, data.caseId);
    const { data: artifact, error } = await db.from("cctv_evidence_artifacts").select("*").eq("id", data.artifactId).eq("tenant_id", context.tenantId).maybeSingle();
    if (error) throw error;
    if (!artifact) throw new Error("CCTV_ARTIFACT_NOT_FOUND");
    const { data: observation } = await db.from("cctv_observations").select("id,case_id").eq("id", artifact.observation_id).eq("tenant_id", context.tenantId).maybeSingle();
    if (!observation || observation.case_id !== data.caseId) throw new Error("CCTV_ARTIFACT_NOT_IN_CASE");
    const { data: signed, error: signError } = await db.storage.from("cctv-evidence").createSignedUrl(artifact.storage_path, 300);
    if (signError) throw signError;
    return { url: signed.signedUrl, sha256: artifact.sha256_hash, mediaType: artifact.media_type, fileName: artifact.file_name };
  });
