import { beforeEach, expect, it, vi } from "vitest";
import { emptyDdCaseDraft } from "./dd-case-draft";
const state = vi.hoisted(() => ({ role: "investigator", rpc: vi.fn() }));
vi.mock("@/lib/auth-middleware", () => ({ tenantMiddleware: {} }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let schema: { parse: (x: unknown) => unknown };
    const b = {
      validator: (v: typeof schema) => {
        schema = v;
        return b;
      },
      middleware: () => b,
      handler: (fn: (a: unknown) => unknown) => (arg: { data: unknown }) =>
        fn({
          data: schema.parse(arg.data),
          context: { role: state.role, supabase: { rpc: state.rpc } },
        }),
    };
    return b;
  },
}));
import { loadDdCaseDraft, saveDdCaseDraft } from "./dd-case-draft.functions";
const caseId = "00000000-0000-4000-8000-000000000001";
beforeEach(() => {
  state.role = "investigator";
  state.rpc.mockReset();
});
it("loads only the requested case through the permission-checked RPC", async () => {
  state.rpc.mockResolvedValue({ data: { revision: 2, draft: emptyDdCaseDraft() }, error: null });
  expect((await loadDdCaseDraft({ data: { caseId } })).revision).toBe(2);
  expect(state.rpc).toHaveBeenCalledWith("cargoiq_load_dd_draft", { p_case_id: caseId });
});
it("sends revision and validated draft, never user-supplied tenant identity", async () => {
  state.rpc.mockResolvedValue({ data: { revision: 3 }, error: null });
  await saveDdCaseDraft({ data: { caseId, revision: 2, draft: emptyDdCaseDraft() } });
  expect(state.rpc).toHaveBeenCalledWith("cargoiq_save_dd_draft", {
    p_case_id: caseId,
    p_revision: 2,
    p_draft: emptyDdCaseDraft(),
  });
});
it("blocks viewer writes before contacting the database", async () => {
  state.role = "viewer";
  await expect(
    saveDdCaseDraft({ data: { caseId, revision: 0, draft: emptyDdCaseDraft() } }),
  ).rejects.toThrow("Investigator");
  expect(state.rpc).not.toHaveBeenCalled();
});
it("propagates database conflict and does not claim success", async () => {
  state.rpc.mockResolvedValue({ data: null, error: new Error("DRAFT_CONFLICT") });
  await expect(
    saveDdCaseDraft({ data: { caseId, revision: 0, draft: emptyDdCaseDraft() } }),
  ).rejects.toThrow("DRAFT_CONFLICT");
});
