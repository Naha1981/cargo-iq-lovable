import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  context: { tenantId: "T", role: "investigator", user: { id: "U" }, supabase: { from: vi.fn() } },
  caseExists: false,
  insert: vi.fn(),
}));
vi.mock("@/lib/auth-middleware", () => ({ tenantMiddleware: {} }));
vi.mock("@/lib/integrated-feature-gate", () => ({ requireIntegratedFeatureReady: async () => {} }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const b = {
      validator: () => b,
      middleware: () => b,
      handler: (fn: (x: unknown) => unknown) => (x: { data: unknown }) =>
        fn({ ...x, context: state.context }),
    };
    return b;
  },
}));
import { createScenario } from "./simulation.functions";
beforeEach(() => {
  vi.clearAllMocks();
  state.caseExists = false;
  state.context.supabase.from = vi.fn((table: string) => {
    const q = {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: state.caseExists ? { id: "C" } : null, error: null }),
      insert: (value: unknown) => {
        state.insert(value);
        return q;
      },
      single: async () => ({ data: { id: "S" }, error: null }),
    };
    return q;
  });
});
describe("explicit scenario case binding", () => {
  const data = {
    caseId: "C",
    name: "Synthetic",
    scenarioType: "other" as const,
    severity: "medium" as const,
    assumptions: [],
  };
  it("refuses missing or cross-tenant case before scenario write", async () => {
    await expect(createScenario({ data })).rejects.toThrow("Case unavailable");
    expect(state.insert).not.toHaveBeenCalled();
  });
  it("stores exact case reference, independent of same port or vessel", async () => {
    state.caseExists = true;
    await createScenario({ data });
    expect(state.insert).toHaveBeenCalledWith(
      expect.objectContaining({ evidence_refs: [{ kind: "case", id: "C" }] }),
    );
  });
});

describe("case-bound comparison confidentiality", () => {
  it("queries only bound cases and explicitly linked events, stores no other case identifiers", async () => {
    const { runScenarioComparison } = await import("./simulation.functions");
    const scopes: Array<[string, string, unknown]> = [];
    let saved: Record<string, unknown> = {};
    const scenario = {
      id: "S",
      name: "Synthetic",
      scenario_type: "other",
      severity: "medium",
      status: "draft",
      evidence_refs: [{ kind: "case", id: "C" }],
      assumptions: [],
      port_code: "ZADUR",
    };
    state.context.supabase.from = vi.fn((table: string) => {
      let ids: string[] | undefined;
      const q = {
        select: () => q,
        eq: () => q,
        in: (key: string, values: string[]) => {
          ids = values;
          scopes.push([table, key, values]);
          return q;
        },
        maybeSingle: async () => ({ data: scenario, error: null }),
        update: (value: Record<string, unknown>) => {
          saved = value;
          return q;
        },
        single: async () => ({ data: saved, error: null }),
        then: (resolve: (x: unknown) => unknown) =>
          resolve({
            error: null,
            data:
              table === "cases"
                ? [
                    { id: "C", reference_no: "SYN", port_code: "ZADUR", vessel_name: null },
                    {
                      id: "UNRELATED_CASE",
                      reference_no: "PRIVATE_NOTE",
                      port_code: "ZADUR",
                      vessel_name: null,
                    },
                  ].filter((c) => ids?.includes(c.id))
                : table === "risk_event_case_links"
                  ? [{ event_id: "E" }]
                  : [
                      {
                        id: "E",
                        kind: "other",
                        port_code: "ZADUR",
                        corridor: null,
                        vessel_name: null,
                        verification_status: "unverified",
                        observed_at: "2026-10-26T10:00:00Z",
                      },
                      { id: "UNRELATED_EVENT", kind: "other", port_code: "ZADUR" },
                    ].filter((e) => ids?.includes(e.id)),
          }),
      };
      return q;
    });
    await runScenarioComparison({ data: { scenarioId: "S" } });
    expect(scopes).toContainEqual(["cases", "id", ["C"]]);
    expect(scopes).toContainEqual(["risk_event_case_links", "case_id", ["C"]]);
    expect(scopes).toContainEqual(["risk_events", "id", ["E"]]);
    expect(JSON.stringify(saved)).not.toMatch(/UNRELATED_CASE|UNRELATED_EVENT|PRIVATE_NOTE/);
    expect(saved.baseline_metrics).toEqual(
      expect.objectContaining({ shipmentsTotal: 1, caseScopeVersion: "1", caseIds: ["C"] }),
    );
  });
});
