import { Blob } from "node:buffer";
import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const state = vi.hoisted(() => ({
  role: "investigator",
  caseOk: true,
  docError: false,
  obsError: false,
  insert: vi.fn(),
  download: vi.fn(),
  from: vi.fn(),
}));
vi.mock("@/lib/auth-middleware", () => ({ tenantMiddleware: {} }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const b = {
      validator: () => b,
      middleware: () => b,
      handler: (fn: (a: unknown) => unknown) => (a: unknown) =>
        fn({
          ...(a as object),
          context: {
            role: state.role,
            tenantId: "tenant",
            supabase: { from: state.from, storage: { from: () => ({ download: state.download }) } },
          },
        }),
    };
    return b;
  },
}));
import { addSplatSnapshot } from "./splat-snapshot.functions";
import { SPLAT_SAMPLE } from "./visual-evidence";
const bytes = new Uint8Array([255, 216, 255, 217]),
  hash = createHash("sha256").update(bytes).digest("hex");
const input = {
  caseId: "00000000-0000-4000-8000-000000000001",
  filePath: "tenant/00000000-0000-4000-8000-000000000001/test.jpg",
  proposal: {
    kind: "GAUSSIAN_SPLAT_VIEW" as const,
    classification: "ILLUSTRATIVE_SYNTHETIC" as const,
    source: SPLAT_SAMPLE.source,
    licence: "CC0-1.0" as const,
    acquiredAt: null,
    capturedAt: "2026-11-12T07:00:00Z",
    sceneSha256: SPLAT_SAMPLE.sha256,
    imageSha256: hash,
    camera: {
      position: [1, 2, 3] as [number, number, number],
      target: [0, 0, 0] as [number, number, number],
    },
    limitations: SPLAT_SAMPLE.limitations,
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  state.role = "investigator";
  state.caseOk = true;
  state.docError = false;
  state.obsError = false;
  state.download.mockResolvedValue({ data: new Blob([bytes]), error: null });
  state.from.mockImplementation((table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: state.caseOk ? { id: input.caseId } : null, error: null }),
      insert: (data: unknown) => {
        state.insert(table, data);
        return q;
      },
      single: async () => ({
        data: { id: table === "documents" ? "doc" : "obs" },
        error:
          table === "documents" && state.docError
            ? { message: "docfail" }
            : table === "external_observations" && state.obsError
              ? { message: "obsfail" }
              : null,
      }),
    };
    return q;
  });
});
it("denies viewers before reads or writes", async () => {
  state.role = "viewer";
  await expect(addSplatSnapshot({ data: input })).rejects.toThrow("Investigator");
  expect(state.from).not.toHaveBeenCalled();
});
it("denies cross-tenant storage before download", async () => {
  await expect(
    addSplatSnapshot({ data: { ...input, filePath: "other/" + input.filePath } }),
  ).rejects.toThrow("INVALID_STORAGE_PATH");
  expect(state.download).not.toHaveBeenCalled();
});
it("requires the case in the tenant before download", async () => {
  state.caseOk = false;
  await expect(addSplatSnapshot({ data: input })).rejects.toThrow("CASE_NOT_FOUND");
  expect(state.download).not.toHaveBeenCalled();
});
it("rejects wrong JPEG byte format", async () => {
  state.download.mockResolvedValue({ data: new Blob(["not jpeg"]), error: null });
  await expect(addSplatSnapshot({ data: input })).rejects.toThrow("INVALID_JPEG");
  expect(state.insert).not.toHaveBeenCalled();
});
it("rejects a changed JPEG before insert", async () => {
  await expect(
    addSplatSnapshot({
      data: { ...input, proposal: { ...input.proposal, imageSha256: "a".repeat(64) } },
    }),
  ).rejects.toThrow("HASH_MISMATCH");
  expect(state.insert).not.toHaveBeenCalled();
});
it("does not create observation after a document failure", async () => {
  state.docError = true;
  await expect(addSplatSnapshot({ data: input })).rejects.toEqual({ message: "docfail" });
  expect(state.insert).toHaveBeenCalledTimes(1);
});
it("reports partial save and retained document without auto retry", async () => {
  state.obsError = true;
  await expect(addSplatSnapshot({ data: input })).rejects.toThrow(
    "SNAPSHOT_PARTIAL_SAVE: Document doc retained",
  );
  expect(state.insert).toHaveBeenCalledTimes(2);
});
it("retains bytes and explicit illustrative provenance in frozen-source observation", async () => {
  const r = await addSplatSnapshot({ data: input });
  expect(r).toEqual({ documentId: "doc", observationId: "obs", sha256: hash });
  const payload = state.insert.mock.calls[1][1];
  expect(payload.tenant_id).toBe("tenant");
  expect(payload.case_id).toBe(input.caseId);
  expect(payload.confidence).toBe(0);
  expect(payload.latitude).toBeNull();
  expect(payload.payload.sceneSha256).toBe(SPLAT_SAMPLE.sha256);
  expect(payload.payload.acquiredAt).toBeNull();
  expect(payload.payload.imageJpeg).toBe(
    "data:image/jpeg;base64," + Buffer.from(bytes).toString("base64"),
  );
  expect(payload.payload.provenanceNote).toContain("not a trusted renderer attestation");
});
