import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { splatProposal, SPLAT_SAMPLE, saveSplatInput } from "./visual-evidence";
import { buildEvidencePackPdf } from "./pack-pdf";
const valid = {
  kind: "GAUSSIAN_SPLAT_VIEW",
  classification: "ILLUSTRATIVE_SYNTHETIC",
  source: SPLAT_SAMPLE.source,
  licence: "CC0-1.0",
  acquiredAt: null,
  capturedAt: "2026-11-12T07:00:00Z",
  sceneSha256: SPLAT_SAMPLE.sha256,
  imageSha256: "a".repeat(64),
  camera: { position: [1, 2, 3], target: [0, 0, 0] },
  limitations: SPLAT_SAMPLE.limitations,
  imageJpeg: "data:image/jpeg;base64,/9j/",
};
describe("Gaussian viewpoint evidence contract", () => {
  it("checks exact original scene bytes", () => {
    const b = readFileSync("public/splat-sample/illustrative-harbour.splat");
    expect(createHash("sha256").update(b).digest("hex")).toBe(SPLAT_SAMPLE.sha256);
    expect(b.length % 32).toBe(0);
  });
  it("accepts explicit synthetic provenance", () => {
    expect(splatProposal.parse(valid).classification).toBe("ILLUSTRATIVE_SYNTHETIC");
  });
  for (const [field, value] of Object.entries({
    classification: "OBSERVED",
    acquiredAt: "2026-11-12T07:00:00Z",
    sceneSha256: "b".repeat(64),
    licence: "Commercial",
    source: "Durban camera",
    limitations: "Verified evidence",
    camera: { position: [Infinity, 0, 0], target: [0, 0, 0] },
    imageJpeg: "javascript:alert(1)",
  }))
    it("rejects invalid " + field, () =>
      expect(splatProposal.safeParse({ ...valid, [field]: value }).success).toBe(false),
    );
  it("requires a valid case ID", () => {
    expect(
      saveSplatInput.safeParse({ caseId: "wrong", filePath: "foo", proposal: valid }).success,
    ).toBe(false);
  });
  it("keeps procedural study out of independent observations PDF section", () => {
    const pdf = Buffer.from(
      buildEvidencePackPdf({
        status: "DRAFT",
        test_hash: true,
        pack_payload: {
          externalObservations: [
            {
              source: SPLAT_SAMPLE.source,
              observation_type: "GAUSSIAN_SPLAT_VIEW",
              observed_at: valid.capturedAt,
              payload: { ...valid, imageJpeg: undefined, sha256: valid.imageSha256 },
            },
          ],
        },
      }),
    ).toString("latin1");
    expect(pdf).toContain("ILLUSTRATIVE GAUSSIAN VIEWPOINTS");
    expect(pdf).toContain("NOT SHIPMENT EVIDENCE");
    expect(pdf).toContain(SPLAT_SAMPLE.sha256);
    expect(pdf).toContain("Acquisition: none");
    expect(pdf).not.toContain("7. INDEPENDENT OBSERVATIONS");
  });
  it("retains server-side scope, role, byte integrity and partial-save guard", () => {
    const src = readFileSync("src/lib/splat-snapshot.functions.ts", "utf8");
    for (const text of [
      "tenantMiddleware",
      "Investigator access required",
      "INVALID_STORAGE_PATH",
      "CASE_NOT_FOUND",
      "SNAPSHOT_HASH_MISMATCH",
      "SNAPSHOT_PARTIAL_SAVE",
      "confidence: 0",
      "latitude: null",
    ])
      expect(src).toContain(text);
  });
  it("does not bypass the existing integrated scene gate", () => {
    const src = readFileSync("src/routes/cases.$caseId.scene.tsx", "utf8");
    expect(src).toContain('<IntegratedFeatureGate title="3D Scene">');
    expect(src).toContain("GaussianSplatPanel");
  });
});
