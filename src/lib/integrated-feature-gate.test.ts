import { describe, expect, it } from "vitest";
import {
  INTEGRATED_FEATURE_UNAVAILABLE,
  requireIntegratedFeatureReady,
} from "./integrated-feature-gate";
import { readFileSync } from "node:fs";

describe("unfinished integrated workspaces fail closed", () => {
  it("does not infer readiness from a table read or environment flag", () => {
    expect(() => requireIntegratedFeatureReady()).toThrow(INTEGRATED_FEATURE_UNAVAILABLE);
  });
  it.each(["revenue-recovery", "scene", "gehi", "simulation"])(
    "guards every %s server handler",
    (name) => {
      const code = readFileSync(`src/lib/${name}.functions.ts`, "utf8");
      expect(code.match(/\.handler\(async/g)?.length).toBe(
        code.match(/requireIntegratedFeatureReady\(\);/g)?.length,
      );
    },
  );
  it.each(["recovery", "scene", "geospatial", "simulation"])(
    "shows safe %s unavailable route",
    (name) => {
      expect(readFileSync(`src/routes/cases.$caseId.${name}.tsx`, "utf8")).toContain(
        "<IntegratedFeatureUnavailable",
      );
    },
  );
});
