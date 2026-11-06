import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildEvidencePackPdf } from "./pack-pdf";
it("embeds original JPEG and freezes exhibit/audit/identity sections", () => {
  const image =
    "data:image/jpeg;base64," +
    readFileSync("fixture/synthetic-map-rendition.jpg").toString("base64");
  const bytes = buildEvidencePackPdf({
    status: "DRAFT",
    version: 1,
    test_hash: true,
    sha256_hash: "a".repeat(64),
    pack_payload: {
      generatedAt: "2026-11-06T05:10:00Z",
      case: { reference_no: "SYNTHETIC REPAIR PREVIEW" },
      documents: [
        {
          id: "synthetic",
          name: "SYNTHETIC map.jpg",
          sha256_hash: "b".repeat(64),
          source_party: "SYNTHETIC SOURCE",
        },
      ],
      externalObservations: [
        {
          observation_type: "MAP_SNAPSHOT",
          observed_at: "2026-11-06T05:10:00Z",
          source: "SYNTHETIC",
          payload: { imageJpeg: image },
        },
      ],
      exporterIdentity: { userId: "SYNTHETIC-user" },
      custodyAudit: [{ action: "SYNTHETIC_UPLOAD", recordedAt: "2026-11-06T05:09:00Z" }],
      versionHistory: [],
    },
  });

  const text = Buffer.from(bytes).toString("latin1");
  expect(text).toContain("/Subtype /Image");
  expect(text).toContain("EX-0001");
  expect(text).toContain("SYNTHETIC-user");
  expect(text).toContain("SYNTHETIC_UPLOAD");
});
