import { z } from "zod";
import { buildEvidencePackPdf } from "./pack-pdf";
import { demoRecords, findTimestampConflicts } from "./cuf-demo";
import { splatProposal } from "./visual-evidence";
const vec = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const realTreeProposal = z.object({
  kind: z.literal("GAUSSIAN_SPLAT_VIEW"),
  classification: z.literal("EXTERNAL_REAL_PLACE_REFERENCE"),
  source: z.literal("Yvig, Tree. iPhone capture, trained Gaussian splat, low-resolution version."),
  licence: z.literal("CC BY 4.0"),
  acquiredAt: z.null(),
  capturedAt: z.string().datetime(),
  sceneSha256: z.literal("6b419aa383b862d3ccfd2b4dd34ead386350760b696174c9fe931ac4cb28e378"),
  imageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  camera: z.object({ position: vec, target: vec }),
  limitations: z.array(z.string()).max(10),
  imageJpeg: z.string().max(1_000_000).startsWith("data:image/jpeg;base64,"),
});
export const sampleVisualCapture = z.union([splatProposal, realTreeProposal]);
export type SampleVisualCapture = z.infer<typeof sampleVisualCapture>;
export const sha256 = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
export async function exportCountingSample(input: {
  selectedRecordId: string;
  captures: SampleVisualCapture[];
  camera?: boolean;
}) {
  const selected = demoRecords.find((r) => r.record_id === input.selectedRecordId);
  if (!selected) throw Error("Unknown sample claim");
  const now = new Date().toISOString();
  const documents = await Promise.all(
    demoRecords.map(async (r) => ({
      id: r.record_id,
      name: r.record_id + " fictional source record.json",
      source_party: r.source_party,
      sha256_hash: await sha256(new TextEncoder().encode(JSON.stringify(r))),
    })),
  );
  const externalObservations = [];
  for (const raw of input.captures) {
    const c = sampleVisualCapture.parse(raw);
    const bytes = Uint8Array.from(atob(c.imageJpeg.split(",")[1]), (x) => x.charCodeAt(0));
    if ((await sha256(bytes)) !== c.imageSha256) throw Error("Capture hash mismatch");
    const real = c.classification === "EXTERNAL_REAL_PLACE_REFERENCE";
    externalObservations.push({
      observation_type: real ? "REFERENCE_VIEW" : "GAUSSIAN_SPLAT_VIEW",
      source: c.source,
      observed_at: c.capturedAt,
      payload: {
        ...c,
        title: real ? "Tree by Yvig, real-world scene reference" : "Illustrative harbour study",
        sourceUrl: real
          ? "https://yvig.fr/work/gaussian-splatting/"
          : "Original CargoIQ procedural geometry",
        attribution: real
          ? "Tree by Yvig, CC BY 4.0. Converted from author low-resolution YSP1; no endorsement."
          : "Original CargoIQ procedural geometry, CC0-1.0",
        acquisitionNote: real ? "Exact place and acquisition time unknown" : "None, synthetic",
        selectedClaimId: selected.record_id,
        selectedEventId: selected.event_reference,
        eventAt: selected.timestamp_utc || "Not supplied",
        windowStart: "2026-10-14T06:00:00Z",
        windowEnd: "2026-10-14T20:00:00Z",
        sha256: c.imageSha256,
        provenanceNote:
          "SAMPLE DRAFT ONLY. Browser capture, not authenticated storage or database seal.",
      },
    });
  }
  if (input.camera) {
    const url = "/sample-camera/pyc-marina-20261112-093305-source.jpg";
    const r = await fetch(url);
    if (!r.ok) throw Error("Camera source file unavailable");
    const bytes = new Uint8Array(await r.arrayBuffer());
    const expected = "21d3ad0bdbfb39473db14b97c59420db36a2071f6314a69ae2a29cd225c88af5";
    if ((await sha256(bytes)) !== expected) throw Error("Camera source hash mismatch");
    let bin = "";
    for (const x of bytes) bin += String.fromCharCode(x);
    externalObservations.push({
      observation_type: "REFERENCE_VIEW",
      source: "PYC Marina / Point Yacht Club",
      observed_at: "2026-11-12T07:33:28Z",
      payload: {
        title: "Unmodified PYC Marina recorded reference still",
        sourceUrl: "https://restreamer.cd.net.za/c1b53a50-06bb-47da-916a-01fb19d5c547.html",
        attribution:
          "PYC Marina / Point Yacht Club; stream sponsored by EdgeConnect. CC BY 4.0 declared by source config, author blank. Unmodified source JPEG.",
        capturedAt: "2026-11-12T07:33:28Z",
        acquisitionNote:
          "Camera overlay12/11/2026 09:33:05. Clock and timezone not independently verified.",
        sourceSha256: expected,
        imageSha256: expected,
        imageJpeg: "data:image/jpeg;base64," + btoa(bin),
        selectedClaimId: selected.record_id,
        eventAt: selected.timestamp_utc || "Not supplied",
        windowStart: "2026-10-14T06:00:00Z",
        windowEnd: "2026-10-14T20:00:00Z",
        limitations:
          "Current reference still, NOT footage of the14October sample event. No vessel/container/truck identity inferred. No server save or custody history.",
      },
    });
  }
  const payload = {
    generatedAt: now,
    case: {
      reference_no: "SYN-COUNT-CLOCK-01 / FICTIONAL DRAFT",
      title: "Sample counting and clock review with reference views",
      vessel_name: "VESSEL-SYN-01, fictional",
      container_no: "SYN-C01 + SYN-C02, fictional",
      port_code: "Durban reference only, shipment coordinates absent",
      dispute_type: "Fictional gate-in clock conflict remains unresolved",
    },
    documents,
    claims: demoRecords.map((r) => ({
      id: r.record_id,
      document_id: r.record_id,
      claim_text: r.statement,
      claim_type: r.claim_type,
      timestamp_claimed: r.timestamp_utc,
      status: "PENDING",
      nature: "REPORTED",
      confidence: 0,
    })),
    timeline: demoRecords
      .filter((r) => r.timestamp_utc)
      .map((r) => ({
        title: r.statement,
        timestamp: r.timestamp_utc,
        source: r.source_party + " / " + r.record_id,
        nature: "REPORTED",
      })),
    contradictions: findTimestampConflicts(demoRecords).map((x) => ({
      title: "Unresolved gate-in timestamp conflict",
      status: "OPEN",
      description:
        x.records.join(", ") + ":18:00 versus19:00UTC. No liability or money calculated.",
    })),
    externalObservations,
    truthRule:
      "Fictional source records. References are not event evidence. UNRESOLVED DRAFT, not ready for submission, no authenticated save or database seal.",
  };
  const hash = await sha256(new TextEncoder().encode(JSON.stringify(payload)));
  return {
    pdf: buildEvidencePackPdf({
      status: "DRAFT",
      version: 1,
      generated_at: now,
      test_hash: true,
      sha256_hash: hash,
      pack_payload: payload,
    }),
    payload,
    hash,
  };
}
