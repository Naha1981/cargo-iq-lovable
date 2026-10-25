// Evidence-truth rendering tests for the Harbour Evidence Map, plus a harness
// that writes the rendered SVG to /tmp for headless-Chrome pixel inspection.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { writeFileSync } from "node:fs";

const fakeCase = { id: "case-1", reference_no: "DUR-2026-0412", vessel_name: "MV Umhlanga Trader", voyage_no: "214S", container_no: "MSKU7748213" };

let loaderData: any;

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    createFileRoute: () => () => ({ useParams: () => ({ caseId: "case-1" }), head: () => ({}) }),
    Link: ({ children, ...rest }: any) => <a {...rest}>{children}</a>,
    useRouter: () => ({ invalidate: async () => {} }),
  };
});
vi.mock("../routes/cases.$caseId", () => ({ Route: { useLoaderData: () => loaderData } }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ storage: { from: () => ({ upload: async () => ({ error: null }) }) } }) }));
vi.mock("@/lib/case.functions", () => ({ corroborateCase: async () => ({}) }));
vi.mock("@/lib/map-snapshot.functions", () => ({ addMapSnapshot: async () => ({ sha256: "deadbeefcafe" }) }));

import { MapPage } from "./cases.$caseId.map";

const base = {
  case: fakeCase,
  tenantId: "t1",
  documents: [{ file_path: "demo/sample.pdf" }],
  contradictions: [],
  claims: [],
};

const scene = { id: "sc1", observation_type: "SENTINEL_2_SCENE", observed_at: "2026-09-04T07:52:00.000Z", payload: { id: "scene-1", relativeOrbit: 42, cloudPercent: 12 } };
const event = { id: "ev1", timestamp: "2026-09-06T14:20:00.000Z", title: "Terminal release recorded", nature: "observed" };
const fix1 = { observation_type: "AIS_POSITION", observed_at: "2026-09-02T08:00:00.000Z", latitude: -29.8, longitude: 31.0, payload: { sog: 4, cog: 90, mmsi: "111", vesselName: "MV Umhlanga Trader" } };
const fix2 = { observation_type: "AIS_POSITION", observed_at: "2026-09-02T10:00:00.000Z", latitude: -29.9, longitude: 31.1, payload: { sog: 8, cog: 95, mmsi: "111", vesselName: "MV Umhlanga Trader" } };

function renderMap(data: any) {
  loaderData = data;
  return render(<MapPage />);
}

function dumpSvg(container: HTMLElement, name: string) {
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("no svg rendered");
  writeFileSync("/tmp/" + name, "<!doctype html><html><body style=\"margin:0;background:#061016\">" + svg.outerHTML + "</body></html>");
}

describe("Harbour map rendering - evidence truth", () => {
  it("empty track: no vessel marker, no coordinates, explicit no-positions notice with case identity", () => {
    const { container } = renderMap({ ...base, observations: [scene], timeline: [event] });
    const svg = container.querySelector("svg")!;
    expect(svg.querySelector("animate")).toBeNull(); // no pulsing vessel marker
    const text = svg.textContent!;
    expect(text).toContain("NO RECORDED POSITIONS");
    expect(text).toContain("DUR-2026-0412 · MV Umhlanga Trader · voyage 214S · Container MSKU7748213");
    expect(text).toContain("schematic terminal zones");
    expect(text).toContain("SCHEMATIC HARBOUR BACKDROP");
    expect(text).not.toMatch(/-29\.\d{4,} \/ 31\.\d/); // no fabricated coordinates
    expect(container.textContent).toContain("NO RECORDED POSITIONS"); // status card
    expect(container.textContent).not.toContain("35 KM RADIUS");
    dumpSvg(container, "map-empty.html");
  });

  it("tracked: marker renders from recorded fixes; provenance distinguishes fix vs derived", () => {
    const { container, getByLabelText } = renderMap({ ...base, observations: [fix1, fix2], timeline: [event] });
    const svg = container.querySelector("svg")!;
    expect(svg.querySelector("animate")).not.toBeNull(); // marker present
    expect(svg.textContent).toContain("RECORDED AIS FIX 08:00Z"); // playback starts exactly on the first fix
    expect(container.textContent).toContain("-29.80000 / 31.00000"); // real coordinates from first fix
    fireEvent.change(getByLabelText("Investigation timeline"), { target: { value: String(Date.parse("2026-09-02T09:00:00.000Z")) } });
    expect(svg.textContent).toContain("DERIVED BETWEEN FIXES 08:00Z-10:00Z"); // midpoint is derived, not recorded
    expect(container.textContent).toContain("-29.85000 / 31.05000"); // interpolated, labelled as such
    fireEvent.change(getByLabelText("Investigation timeline"), { target: { value: String(Date.parse("2026-09-06T12:00:00.000Z")) } });
    expect(svg.textContent).toContain("LAST RECORDED 10:00Z - NO NEWER POSITIONS"); // stale, not current
    dumpSvg(container, "map-tracked.html");
  });

  it("zoom in crops the viewBox towards the vessel; reset restores", () => {
    const { container, getByLabelText } = renderMap({ ...base, observations: [fix1, fix2], timeline: [event] });
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 1000 640");
    fireEvent.click(getByLabelText("Zoom in"));
    const cropped = svg.getAttribute("viewBox")!;
    expect(cropped).not.toBe("0 0 1000 640");
    const [, , w, h] = cropped.split(" ").map(Number);
    expect(w).toBeCloseTo(1000 / 1.5, 0);
    expect(h).toBeCloseTo(640 / 1.5, 0);
    dumpSvg(container, "map-zoomed.html");
  });

  it("no temporal evidence at all: playback replaced by a plain no-play state", () => {
    const { container, queryByText } = renderMap({ ...base, observations: [], timeline: [] });
    expect(queryByText("Play timeline")).toBeNull();
    expect(container.textContent).toContain("no recorded positions, satellite passes or case events yet");
  });
});
