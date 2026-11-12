import { z } from "zod";
/** The demo is original procedural geometry, never a scan or a measured site. */
export const SPLAT_SAMPLE = {
  name: "Illustrative harbour study",
  source: "Original CargoIQ procedural geometry",
  sourcePath: "/splat-sample/illustrative-harbour.splat",
  sha256: "a027e97f01ba755ac96ba009f9af05cbd26dd6c9aa0e9361e528f824521a345d",
  licence: "CC0-1.0",
  limitations:
    "Not a scan of Durban, a vessel, a berth or a shipment. No georeferencing, capture time, measurements or historical evidence. Demonstrates Gaussian rendering and viewpoint capture only.",
} as const;
const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
export const splatProposal = z.object({
  kind: z.literal("GAUSSIAN_SPLAT_VIEW"),
  classification: z.literal("ILLUSTRATIVE_SYNTHETIC"),
  source: z.literal(SPLAT_SAMPLE.source),
  licence: z.literal(SPLAT_SAMPLE.licence),
  acquiredAt: z.null(),
  capturedAt: z.string().datetime(),
  sceneSha256: z.literal(SPLAT_SAMPLE.sha256),
  imageSha256: z.string().regex(/^[a-f0-9]{64}$/),
  camera: z.object({ position: vector, target: vector }),
  limitations: z.literal(SPLAT_SAMPLE.limitations),
  imageJpeg: z.string().max(1_000_000).startsWith("data:image/jpeg;base64,"),
});
export type SplatProposal = z.infer<typeof splatProposal>;
export const saveSplatInput = z.object({
  caseId: z.string().uuid(),
  filePath: z.string().max(1000),
  proposal: splatProposal.omit({ imageJpeg: true }),
});
