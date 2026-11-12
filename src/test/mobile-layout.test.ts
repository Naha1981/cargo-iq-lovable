import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
const source = (path: string) => readFileSync(path, "utf8");
describe("phone investigation layout", () => {
  it("keeps every navigation choice visible", () => {
    expect(source("src/routes/cases.$caseId.tsx")).toContain("grid grid-cols-2");
  });
  it("uses non-overlapping stacked timeline events on phones", () => {
    // The evidence timeline is one stacked vertical list at every width, so
    // phone events can never overlap the way the old absolute-positioned
    // desktop-only rail could.
    expect(source("src/routes/cases.$caseId.index.tsx")).toContain("EvidenceTimeline");
    const timeline = source("src/components/EvidenceTimeline.tsx");
    expect(timeline).toContain('aria-label="Evidence timeline"');
    expect(timeline).toContain("space-y-4");
    expect(timeline).not.toContain("absolute top-1/2");
  });
  it("keeps map events and playback below the phone map, not over it", () => {
    const map = source("src/components/HarbourEvidenceMap.tsx");
    expect(source("src/routes/cases.$caseId.map.tsx")).toContain("<HarbourEvidenceMap");
    expect(map).toContain("relative mx-3 mt-3 md:absolute");
    expect(map).toContain("EVENTS WITHIN 24H OF PLAYBACK");
    expect(map).not.toContain("h-[480px]");
  });
});
