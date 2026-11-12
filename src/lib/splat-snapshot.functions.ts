import { createServerFn } from "@tanstack/react-start";
import { tenantMiddleware } from "@/lib/auth-middleware";
import { sha256Hex } from "@/lib/hash";
import { assertDocumentSize } from "@/lib/extraction-policy";
import { saveSplatInput, SPLAT_SAMPLE } from "@/lib/visual-evidence";

/** Uses existing tenant-scoped evidence storage; no schema or readiness bypass. */
export const addSplatSnapshot = createServerFn({ method: "POST" })
  .validator(saveSplatInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    if (!data.filePath.startsWith(context.tenantId + "/" + data.caseId + "/"))
      throw new Error("INVALID_STORAGE_PATH");
    const { data: caseRow, error: caseError } = await context.supabase
      .from("cases")
      .select("id")
      .eq("id", data.caseId)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (caseError) throw caseError;
    if (!caseRow) throw new Error("CASE_NOT_FOUND");
    const { data: blob, error } = await context.supabase.storage
      .from("case-documents")
      .download(data.filePath);
    if (error || !blob) throw error ?? new Error("SNAPSHOT_DOWNLOAD_FAILED");
    assertDocumentSize(blob.size);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length > 750000 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255)
      throw new Error("INVALID_JPEG_SNAPSHOT");
    const sha256 = await sha256Hex(bytes.buffer);
    if (sha256 !== data.proposal.imageSha256) throw new Error("SNAPSHOT_HASH_MISMATCH");
    const { data: doc, error: docError } = await context.supabase
      .from("documents")
      .insert({
        tenant_id: context.tenantId,
        case_id: data.caseId,
        name: "ILLUSTRATIVE Gaussian viewpoint - not shipment evidence",
        file_path: data.filePath,
        file_type: "image/jpeg",
        sha256_hash: sha256,
        source_party: SPLAT_SAMPLE.source,
      })
      .select("id")
      .single();
    if (docError) throw docError;
    const imageJpeg =
      "data:image/jpeg;base64," + btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
    const { data: observation, error: obsError } = await context.supabase
      .from("external_observations")
      .insert({
        tenant_id: context.tenantId,
        case_id: data.caseId,
        source: SPLAT_SAMPLE.source,
        observation_type: "GAUSSIAN_SPLAT_VIEW",
        observed_at: data.proposal.capturedAt,
        latitude: null,
        longitude: null,
        confidence: 0,
        limitation: SPLAT_SAMPLE.limitations,
        payload: {
          ...data.proposal,
          document_id: doc.id,
          sha256,
          sourcePath: SPLAT_SAMPLE.sourcePath,
          imageJpeg,
          serverReceivedAt: new Date().toISOString(),
          provenanceNote:
            "Viewpoint supplied by the investigator browser; the server verified JPEG bytes and hash, not a trusted renderer attestation. Scene acquisition time is unknown; capture time is browser-reported.",
        },
      })
      .select("id")
      .single();
    if (obsError)
      throw new Error(
        "SNAPSHOT_PARTIAL_SAVE: Document " +
          doc.id +
          " retained; observation not confirmed. Inspect case documents before retrying. " +
          obsError.message,
      );
    return { documentId: doc.id, observationId: observation.id, sha256 };
  });
