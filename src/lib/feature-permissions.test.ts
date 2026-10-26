import { beforeEach, describe, expect, it, vi } from "vitest";
// These tests exercise inner tenant guards under a hypothetical future verified release.
// The independent release-gate suite proves today's default refusal.
vi.mock("@/lib/integrated-feature-gate", () => ({ requireIntegratedFeatureReady: () => {} }));
const state = vi.hoisted(() => ({ context: {} as Record<string, unknown> }));
vi.mock("@/lib/auth-middleware", () => ({ tenantMiddleware: {} }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const b = {
      validator: () => b,
      middleware: () => b,
      handler: (fn: (arg: unknown) => unknown) => (arg: { data: unknown }) =>
        fn({ ...arg, context: state.context }),
    };
    return b;
  },
}));
import {
  assignRecoveryFinding,
  runInvoiceComparison,
  updateRecoveryStatus,
} from "./revenue-recovery.functions";
import { reviewGeospatialFinding } from "./gehi.functions";
import { registerSceneAsset } from "./scene.functions";
import { createScenario } from "./simulation.functions";
function client(results: Record<string, unknown>) {
  const from = vi.fn((table: string) => {
    const q: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "insert", "update", "order", "limit"])
      q[method] = vi.fn(() => q);
    q.maybeSingle = vi.fn(async () => ({ data: results[table] ?? null, error: null }));
    q.single = vi.fn(async () => ({ data: results[table] ?? null, error: null }));
    q.then = (resolve: (v: unknown) => void) =>
      resolve({ data: results[table] ?? [], error: null });
    return q;
  });
  return { from };
}
beforeEach(() => {
  state.context = { role: "viewer", tenantId: "T", user: { id: "U" }, supabase: client({}) };
});
describe("feature server permission boundaries", () => {
  it.each([
    [assignRecoveryFinding, { findingId: "F", assignee: null }],
    [runInvoiceComparison, { title: "t", expected: [], actual: [] }],
    [updateRecoveryStatus, { findingId: "F", to: "under_review" }],
    [reviewGeospatialFinding, { findingId: "F", to: "confirmed" }],
    [registerSceneAsset, { name: "scene", sourceType: "ply", provenance: {} }],
    [createScenario, { name: "s", scenarioType: "other", assumptions: [] }],
  ])("viewer write refused before database mutation", async (fn, data) => {
    await expect((fn as (arg: { data: unknown }) => Promise<unknown>)({ data })).rejects.toThrow(
      "Investigator access required",
    );
    expect((state.context.supabase as ReturnType<typeof client>).from).not.toHaveBeenCalled();
  });
  it("refuses assignment to a nonmember before writing finding", async () => {
    state.context.role = "investigator";
    await expect(
      assignRecoveryFinding({ data: { findingId: "F", assignee: "outsider" } }),
    ).rejects.toThrow("ASSIGNEE_NOT_IN_WORKSPACE");
    expect((state.context.supabase as ReturnType<typeof client>).from).toHaveBeenCalledTimes(1);
  });
  it("refuses missing finding instead of reporting assignment success", async () => {
    state.context.role = "investigator";
    await expect(
      assignRecoveryFinding({ data: { findingId: "F", assignee: null } }),
    ).rejects.toThrow("FINDING_NOT_FOUND");
  });
  it("refuses foreign/missing case before comparison insert", async () => {
    state.context.role = "investigator";
    await expect(
      runInvoiceComparison({
        data: {
          caseId: "other",
          requestId: "request",
          title: "t",
          expected: [],
          actual: [],
          sourceDocumentIds: [],
        },
      }),
    ).rejects.toThrow("CASE_NOT_FOUND");
  });
});

it("scene event from another case refused before asset insert", async () => {
  state.context = {
    role: "investigator",
    tenantId: "T",
    user: { id: "U" },
    supabase: client({ timeline_events: [{ id: "E", case_id: "other" }], documents: [] }),
  };
  await expect(
    registerSceneAsset({
      data: {
        caseId: "case",
        name: "s",
        sourceType: "ply",
        provenance: {},
        eventIds: ["E"],
        documentIds: [],
      },
    }),
  ).rejects.toThrow("SCENE_LINK_NOT_IN_CASE");
});
