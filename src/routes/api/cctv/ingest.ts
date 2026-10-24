import { createFileRoute } from "@tanstack/react-router";
import { cctvIngestSchema, defaultCctvLimitation } from "@/lib/cctv-contract";
import { constantTimeEqual, decryptSecret, hmacSha256Base64Url, sha256Hex } from "@/lib/cctv-crypto";

// Returns the decoded body, or null when the stream exceeds maxBytes.
export async function readBodyWithCap(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(merged);
}

export const Route = createFileRoute("/api/cctv/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const declaredLength = Number(request.headers.get("content-length") ?? "0");
        if (Number.isFinite(declaredLength) && declaredLength > 8500000) return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
        // Read the body as a stream with a hard byte cap: a missing or lying Content-Length
        // (or chunked encoding) must not let an unbounded body into memory.
        const rawBody = await readBodyWithCap(request, 8500000);
        if (rawBody === null) return Response.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });

        const sourceId = request.headers.get("x-cargoiq-source-id");
        const timestampHeader = request.headers.get("x-cargoiq-timestamp");
        const nonce = request.headers.get("x-cargoiq-nonce");
        const signature = request.headers.get("x-cargoiq-signature");
        if (!sourceId || !timestampHeader || !nonce || !signature) return Response.json({ error: "MISSING_INGEST_HEADERS" }, { status: 401 });

        const timestamp = Number(timestampHeader);
        if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return Response.json({ error: "STALE_INGEST_REQUEST" }, { status: 401 });

        const { getServiceClient, getCctvEncryptionMasterKey } = await import("@/lib/cctv-server");
        const db = getServiceClient();
        const { data: source, error: sourceError } = await db.from("cctv_sources").select("id,tenant_id,ingest_secret_ciphertext,enabled").eq("id", sourceId).maybeSingle();
        if (sourceError) return Response.json({ error: "INGEST_UNAVAILABLE" }, { status: 503 });
        if (!source || !source.enabled) return Response.json({ error: "UNKNOWN_OR_DISABLED_SOURCE" }, { status: 401 });

        const secret = await decryptSecret(source.ingest_secret_ciphertext, getCctvEncryptionMasterKey());
        const expected = await hmacSha256Base64Url(secret, timestampHeader + "." + nonce + "." + rawBody);
        if (!(await constantTimeEqual(expected, signature))) return Response.json({ error: "INVALID_INGEST_SIGNATURE" }, { status: 401 });

        const { error: nonceError } = await db.from("cctv_ingest_nonces").insert({ source_id: source.id, nonce, observed_at: new Date(timestamp * 1000).toISOString() });
        if (nonceError) {
          if (String(nonceError.code) === "23509" || String(nonceError.code) === "23505") return Response.json({ error: "REPLAYED_NONCE" }, { status: 409 });
          return Response.json({ error: "INGEST_UNAVAILABLE" }, { status: 503 });
        }
        // Nonces only need to outlive the 300-second replay window; purge older rows so the table cannot grow without bound.
        await db.from("cctv_ingest_nonces").delete().lt("observed_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());

        let event: any;
        try { event = cctvIngestSchema.parse(JSON.parse(rawBody)); }
        catch (error) { return Response.json({ error: "VALIDATION_ERROR", details: error instanceof Error ? error.message : "Invalid event" }, { status: 400 }); }

        const eventHash = await sha256Hex(rawBody);
        const idempotencyKey = source.id + ":" + (event.event_id ?? eventHash);
        const { data: existing } = await db.from("cctv_observations").select("id").eq("tenant_id", source.tenant_id).eq("idempotency_key", idempotencyKey).maybeSingle();
        if (existing) return Response.json({ accepted: true, duplicate: true, observation_id: existing.id });

        let { data: camera } = await db.from("cctv_cameras").select("id,source_id,display_name,latitude,longitude").eq("tenant_id", source.tenant_id).eq("source_id", source.id).eq("provider_camera_id", event.camera.provider_id).maybeSingle();
        if (!camera) {
          const { data: created, error } = await db.from("cctv_cameras").insert({
            tenant_id: source.tenant_id, source_id: source.id, provider_camera_id: event.camera.provider_id,
            display_name: event.camera.name ?? "Camera " + event.camera.provider_id, manufacturer: event.camera.manufacturer ?? null,
            stream_type: event.camera.stream_type ?? null, installation_location: event.camera.installation_location ?? null,
            latitude: event.camera.latitude ?? null, longitude: event.camera.longitude ?? null,
            timezone: event.camera.timezone ?? event.timezone ?? "UTC", health_status: "ONLINE", last_seen_at: new Date().toISOString(),
          }).select("id,source_id,display_name,latitude,longitude").single();
          if (error) return Response.json({ error: "CAMERA_REGISTRATION_FAILED" }, { status: 500 });
          camera = created;
        } else {
          await db.from("cctv_cameras").update({ health_status: event.event_type === "CAMERA_OFFLINE" ? "OFFLINE" : "ONLINE", last_seen_at: new Date().toISOString() }).eq("id", camera.id).eq("tenant_id", source.tenant_id);
        }

        let zoneId: string | null = null;
        if (event.zone) {
          const { data: existingZone } = await db.from("cctv_zones").select("id").eq("tenant_id", source.tenant_id).eq("camera_id", camera.id).eq("zone_code", event.zone.code).maybeSingle();
          if (existingZone) zoneId = existingZone.id;
          else {
            const { data: createdZone, error } = await db.from("cctv_zones").insert({
              tenant_id: source.tenant_id, camera_id: camera.id, provider_zone_id: event.zone.provider_id ?? null,
              zone_code: event.zone.code, zone_type: event.zone.type, semantic_purpose: event.zone.semantic_purpose ?? null,
              polygon: event.zone.polygon ?? null,
            }).select("id").single();
            if (error) return Response.json({ error: "ZONE_REGISTRATION_FAILED" }, { status: 500 });
            zoneId = createdZone.id;
          }
        }

        const observationId = crypto.randomUUID();
        const { data: observation, error: observationError } = await db.from("cctv_observations").insert({
          id: observationId, tenant_id: source.tenant_id, source_id: source.id, camera_id: camera.id, zone_id: zoneId,
          provider_event_id: event.event_id ?? null, idempotency_key: idempotencyKey, event_type: event.event_type,
          detected_class: event.detected_class ?? null, observed_at: event.observed_at, source_observed_at: event.source_observed_at ?? null,
          processed_at: new Date().toISOString(), timezone: event.timezone ?? event.camera.timezone ?? "UTC",
          confidence: event.confidence ?? null, model_name: event.model?.name ?? null, model_version: event.model?.version ?? null,
          processing_version: event.processing_version ?? null, roi: event.roi ?? null,
          payload: { ...(event.payload ?? {}), source_notice: "Computer-vision observation generated from a configured CCTV source.", limitation: defaultCctvLimitation() },
          evidence_available: Boolean(event.evidence),
        }).select("id").single();

        if (observationError) return Response.json({ error: "OBSERVATION_PERSIST_FAILED" }, { status: 500 });

        let artifactId: string | null = null;
        if (event.evidence) {
          const binary = Uint8Array.from(atob(event.evidence.base64), (char) => char.charCodeAt(0));
          const hash = await sha256Hex(binary.buffer);
          const safeName = event.evidence.file_name.replace(/[^a-zA-Z0-9._-]+/g, "_");
          const storagePath = source.tenant_id + "/" + source.id + "/" + camera.id + "/" + observationId + "/" + safeName;
          const { error: uploadError } = await db.storage.from("cctv-evidence").upload(storagePath, binary, { contentType: event.evidence.media_type, upsert: false });
          if (uploadError) {
            await db.from("cctv_observations").delete().eq("id", observationId).eq("tenant_id", source.tenant_id);
            return Response.json({ error: "EVIDENCE_UPLOAD_FAILED" }, { status: 502 });
          }
          const { data: artifact, error: artifactError } = await db.from("cctv_evidence_artifacts").insert({
            tenant_id: source.tenant_id, observation_id: observationId, source_id: source.id, camera_id: camera.id,
            storage_path: storagePath, media_type: event.evidence.media_type, file_name: safeName, byte_size: binary.byteLength,
            sha256_hash: hash, captured_at: event.evidence.captured_at ?? event.observed_at,
            source_timestamp: event.source_observed_at ?? event.observed_at, model_name: event.model?.name ?? null,
            model_version: event.model?.version ?? null, processing_version: event.processing_version ?? null,
            metadata: event.evidence.metadata ?? {},
          }).select("id").single();
          if (artifactError) {
            await db.storage.from("cctv-evidence").remove([storagePath]);
            await db.from("cctv_observations").delete().eq("id", observationId).eq("tenant_id", source.tenant_id);
            return Response.json({ error: "EVIDENCE_METADATA_FAILED" }, { status: 500 });
          }
          artifactId = artifact.id;
        }

        return Response.json({ accepted: true, duplicate: false, observation_id: observation?.id ?? observationId, evidence_artifact_id: artifactId });
      },
    },
  },
});
