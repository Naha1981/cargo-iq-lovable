import { readFileSync } from "node:fs";
import { describe, it, expect, vi, afterEach } from "vitest";
import { exportCountingSample, sha256, realTreeProposal } from "./sample-visual-pack";
import { SPLAT_SAMPLE } from "./visual-evidence";
const selectedRecordId = "Q02";
const image = readFileSync("public/sample-camera/pyc-marina-20261112-093305-source.jpg");
const valid = async () => ({
  kind: "GAUSSIAN_SPLAT_VIEW" as const,
  classification: "ILLUSTRATIVE_SYNTHETIC" as const,
  source: SPLAT_SAMPLE.source,
  licence: SPLAT_SAMPLE.licence,
  acquiredAt: null,
  capturedAt: "2026-11-12T07:00:00Z",
  sceneSha256: SPLAT_SAMPLE.sha256,
  imageSha256: await sha256(image),
  imageJpeg: "data:image/jpeg;base64," + image.toString("base64"),
  camera: {
    position: [1, 2, 3] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
  },
  limitations: SPLAT_SAMPLE.limitations,
});
afterEach(() => vi.unstubAllGlobals());
describe("same-case sample export guards", () => {
  it("rejects unknown claim before creating an export", async () => {
    await expect(
      exportCountingSample({ selectedRecordId: "not-a-claim", captures: [] }),
    ).rejects.toThrow("Unknown sample claim");
  });
  it("rejects altered capture bytes", async () => {
    const c = await valid();
    await expect(
      exportCountingSample({ selectedRecordId, captures: [{ ...c, imageSha256: "a".repeat(64) }] }),
    ).rejects.toThrow("Capture hash mismatch");
  });
  it("binds capture to same selected claim and retains all source records and conflict", async () => {
    const x = await exportCountingSample({ selectedRecordId, captures: [await valid()] });
    expect(x.payload.documents).toHaveLength(15);
    expect(x.payload.claims).toHaveLength(15);
    expect(x.payload.externalObservations[0].payload.selectedClaimId).toBe(selectedRecordId);
    expect(x.payload.externalObservations[0].payload.windowStart).toBe("2026-10-14T06:00:00Z");
    expect(x.payload.contradictions[0].status).toBe("OPEN");
    expect(x.payload.claims.every((c) => c.status === "PENDING" && c.confidence === 0)).toBe(true);
    expect(x.hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects camera reference if original source cannot be fetched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );
    await expect(
      exportCountingSample({ selectedRecordId, captures: [], camera: true }),
    ).rejects.toThrow("Camera source file unavailable");
  });
  it("rejects changed camera source bytes rather than silently exporting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("changed")),
    );
    await expect(
      exportCountingSample({ selectedRecordId, captures: [], camera: true }),
    ).rejects.toThrow("Camera source hash mismatch");
  });
  it("real tree cannot claim a known acquisition date or be labelled shipment evidence", async () => {
    const c = {
      ...(await valid()),
      classification: "EXTERNAL_REAL_PLACE_REFERENCE",
      source: "Yvig, Tree. iPhone capture, trained Gaussian splat, low-resolution version.",
      licence: "CC BY 4.0",
      sceneSha256: "6b419aa383b862d3ccfd2b4dd34ead386350760b696174c9fe931ac4cb28e378",
      limitations: ["Not shipment evidence"],
    };
    expect(realTreeProposal.safeParse(c).success).toBe(true);
    expect(realTreeProposal.safeParse({ ...c, acquiredAt: "2026-10-14T06:00:00Z" }).success).toBe(
      false,
    );
    expect(realTreeProposal.safeParse({ ...c, classification: "OBSERVED" }).success).toBe(false);
  });
});
