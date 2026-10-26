import { describe, expect, it } from "vitest";
import {
  INTEGRATED_FEATURE_UNAVAILABLE,
  integratedFeatureReady,
  requireIntegratedFeatureReady,
} from "./integrated-feature-gate";
import { readFileSync } from "node:fs";
describe("integrated workspaces fail closed unless server safeguards validate", () => {
  it.each([
    { data: null, error: null },
    { data: { ready: false }, error: null },
    { data: { ready: true }, error: { message: "error" } },
    { data: { ready: "true" }, error: null },
  ])("refuses nonvalidated readiness %j", async (result) => {
    const client = { rpc: async () => result };
    expect(await integratedFeatureReady(client)).toBe(false);
    await expect(requireIntegratedFeatureReady(client)).rejects.toThrow(
      INTEGRATED_FEATURE_UNAVAILABLE,
    );
  });
  it("accepts only exact server boolean", async () =>
    expect(
      await integratedFeatureReady({ rpc: async () => ({ data: { ready: true }, error: null }) }),
    ).toBe(true));
  it("network refusal stays disabled", async () =>
    expect(
      await integratedFeatureReady({
        rpc: async () => {
          throw new Error("offline");
        },
      }),
    ).toBe(false));
  it.each(["revenue-recovery", "scene", "gehi", "simulation"])(
    "awaits gate in each %s handler",
    (name) => {
      const code = readFileSync(`src/lib/${name}.functions.ts`, "utf8");
      expect(code.match(/\.handler\(async/g)?.length).toBe(
        code.match(/await requireIntegratedFeatureReady\(context.supabase\);/g)?.length,
      );
    },
  );
  it.each(["recovery", "scene", "geospatial", "simulation"])(
    "uses server-checked %s route",
    (name) =>
      expect(readFileSync(`src/routes/cases.$caseId.${name}.tsx`, "utf8")).toContain(
        "<IntegratedFeatureGate",
      ),
  );
});
