import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { tenantMiddleware } from "@/lib/auth-middleware";
import { sha256Hex } from "@/lib/hash";
import { assertDocumentSize } from "@/lib/extraction-policy";

const snapshotInput = z.object({
  caseId: z.string().uuid(),
  filePath: z.string().min(5),
  name: z.string().min(1).max(200),
  observedAt: z.string().min(10),
  summary: z.object({
    vesselName: z.string().nullish(),
    mmsi: z.string().nullish(),
    lat: z.number().nullish(),
    lon: z.number().nullish(),
    sog: z.number().nullish(),
    cog: z.number().nullish(),
    inDisputedWindow: z.boolean(),
    windowStart: z.string().nullish(),
    windowEnd: z.string().nullish(),
    note: z.string().max(500).nullish(),
  }),
});

export const addMapSnapshot = createServerFn({ method: "POST" })
  .validator(snapshotInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const expectedPrefix = context.tenantId + "/" + data.caseId + "/";
    if (!data.filePath.startsWith(expectedPrefix)) throw new Error("INVALID_STORAGE_PATH");

    const { data: blob, error: downloadError } = await context.supabase.storage
      .from("case-documents")
      .download(data.filePath);
    if (downloadError || !blob) throw downloadError ?? new Error("DOCUMENT_DOWNLOAD_FAILED");
    assertDocumentSize(blob.size);
    const sha256 = await sha256Hex(await blob.arrayBuffer());

    const { data: doc, error: docError } = await context.supabase
      .from("documents")
      .insert({
        tenant_id: context.tenantId,
        case_id: data.caseId,
        name: data.name,
        file_path: data.filePath,
        file_type: "image/png",
        sha256_hash: sha256,
        source_party: "CargoIQ harbour map",
      })
      .select("*")
      .single();
    if (docError) throw docError;

    const limitation =
      "Map snapshot rendered from recorded AIS, satellite and case data at the chosen time. It corroborates the recorded positions and coverage; it is not independent sensor data and does not by itself prove contractual liability." +
      (data.summary.inDisputedWindow
        ? " Snapshot time falls inside the case's open disputed window."
        : "");
    const { data: obs, error: obsError } = await context.supabase
      .from("external_observations")
      .insert({
        tenant_id: context.tenantId,
        case_id: data.caseId,
        source: "CargoIQ harbour map snapshot",
        observation_type: "MAP_SNAPSHOT",
        observed_at: data.observedAt,
        latitude: data.summary.lat ?? null,
        longitude: data.summary.lon ?? null,
        payload: { ...data.summary, document_id: doc.id, sha256 },
        confidence: 0.8,
        limitation,
      })
      .select("*")
      .single();
    if (obsError) throw obsError;

    return { documentId: doc.id as string, observationId: obs.id as string, sha256 };
  });
