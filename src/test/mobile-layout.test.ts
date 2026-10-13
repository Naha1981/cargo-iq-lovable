import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const source = (path: string) => readFileSync(path, "utf8");
describe("phone investigation layout", () => {
  it("keeps every navigation choice visible", () => {
    expect(source("src/routes/cases.$caseId.tsx")).toContain("grid grid-cols-2");
  });
  it("uses non-overlapping stacked timeline events on phones", () => {
    expect(source("src/routes/cases.$caseId.index.tsx")).toContain('aria-label="Timeline events"');
    expect(source("src/routes/cases.$caseId.index.tsx")).toContain("hidden h-56 sm:block");
  });
  it("keeps map events and playback below the phone map, not over it", () => {
    const map = source("src/routes/cases.$caseId.map.tsx");
    expect(map).toContain("relative mx-3 mt-3 md:absolute");
    expect(map).toContain("EVENTS WITHIN 24H OF PLAYBACK");
    expect(map).not.toContain("h-[480px]");
  });
});
