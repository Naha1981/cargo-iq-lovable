// Evidence-truth rendering tests for the Harbour Evidence Map, plus a harness
// that writes the whole rendered component (map + fixed overlays + controls)
// into HTML shells linked to the real built stylesheet for headless-Chrome
// pixel inspection.
import { describe, expect, it, vi, afterEach } from "vitest";
import { act, fireEvent, render, within } from "@testing-library/react";
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

// Whole-component dump: fixed overlays and controls are HTML, not SVG, so the
// shell must carry the full markup plus the real built stylesheet.
const APP_CSS = "file:///tmp/cq-mapfix/.output/public/assets/styles-wh_yfZQv.css";
function dumpPage(container: HTMLElement, name: string) {
  const html = "<!doctype html><html><head><meta charset=\"utf-8\">"
    + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
    + "<link rel=\"stylesheet\" href=\"" + APP_CSS + "\">"
    + "</head><body style=\"margin:0\">" + container.innerHTML + "</body></html>";
  writeFileSync("/tmp/" + name, html);
}

afterEach(() => { vi.useRealTimers(); });

describe("Harbour map rendering - evidence truth", () => {
  it("empty track: no vessel marker, no coordinates, explicit no-positions notice with case identity", () => {
    const { container } = renderMap({ ...base, observations: [scene], timeline: [event] });
    const svg = container.querySelector("svg")!;
    expect(svg.querySelector("animate")).toBeNull(); // no pulsing vessel marker
    expect(svg.textContent).toContain("NO RECORDED POSITIONS");
    expect(svg.querySelectorAll("polyline").length).toBeGreaterThan(0); // real coastline drawn
    expect(svg.textContent).not.toMatch(/-29\.\d{4,} \/ 31\.\d/); // no fabricated coordinates
    const all = container.textContent!;
    expect(all).toContain("DUR-2026-0412 · MV Umhlanga Trader · voyage 214S · Container MSKU7748213"); // fixed overlay
    expect(all).toContain("COASTLINE © OPENSTREETMAP CONTRIBUTORS · TERMINAL AREAS APPROXIMATE");
    expect(all).toContain("NO RECORDED POSITIONS"); // status card
    expect(all).not.toContain("35 KM RADIUS");
    dumpPage(container, "map-page-empty.html");
  });

  it("tracked: marker renders from recorded fixes; provenance distinguishes fix vs derived", () => {
    const { container, getByLabelText } = renderMap({ ...base, observations: [fix1, fix2], timeline: [event] });
    const svg = container.querySelector("svg")!;
    expect(svg.querySelector("animate")).not.toBeNull(); // marker present
    expect(svg.textContent).toContain("MV UMHLANGA TRADER"); // vessel named at the marker itself
    expect(container.textContent).toContain("RECORDED AIS FIX 08:00Z"); // playback starts exactly on the first fix
    expect(container.textContent).toContain("-29.80000 / 31.00000"); // real coordinates from first fix
    expect(container.textContent).toContain("RECORDED SPEED 4.0 kn · 08:00Z"); // speed only as recorded
    expect(container.textContent).toContain("VESSEL COURSE · RECORDED 08:00Z"); // course carries its recorded basis + time
    expect(container.textContent).not.toContain("minute by minute"); // no coverage claim the record cannot support
    expect(container.textContent).toContain("FOLLOWING RECORDED POSITION"); // follow, not live tracking
    fireEvent.change(getByLabelText("Investigation timeline"), { target: { value: String(Date.parse("2026-09-02T09:00:00.000Z")) } });
    expect(container.textContent).toContain("DERIVED BETWEEN FIXES 08:00Z-10:00Z"); // midpoint is derived, not recorded
    expect(container.textContent).toContain("VESSEL POSITION · DERIVED - NOT A RECORDING"); // interpolated coords labelled as derived
    expect(container.textContent).toContain("-29.85000 / 31.05000"); // derived coords shown under that label
    expect(container.textContent).toContain("SPEED DERIVED BETWEEN FIXES - APPROXIMATE"); // no precise-looking derived speed
    fireEvent.change(getByLabelText("Investigation timeline"), { target: { value: String(Date.parse("2026-09-06T12:00:00.000Z")) } });
    expect(container.textContent).toContain("LAST RECORDED 10:00Z - NO NEWER POSITIONS"); // stale, not current
    expect(container.textContent).toContain("LAST RECORDED SPEED 8.0 kn · 10:00Z - NO NEWER POSITIONS"); // stale speed labelled, not implied live
    expect(container.textContent).toContain("VESSEL COURSE · LAST RECORDED 10:00Z"); // stale course carries its last-recorded time
    expect(container.textContent).toContain("VESSEL POSITION · LAST RECORDED 10:00Z"); // stale coords carry their last-recorded time
    expect(container.textContent).toContain("Upcoming"); // 14:20 event is after 12:00 playback - not yet evidence
    expect(container.textContent).toContain("No linked source record"); // fixture event has no source - said plainly, not fabricated
    const { container: c2 } = renderMap({ ...base, observations: [fix1, fix2], timeline: [
      { id: "ev2", timestamp: "2026-09-06T11:00:00.000Z", title: "Gate camera movement", nature: "observed", source: "CCTV / Gate 4", provenance_id: "obs-1" },
      { id: "ev3", timestamp: "2026-09-06T10:30:00.000Z", title: "Demurrage claimed", nature: "claimed", source: "cm-letter.pdf", provenance_id: "claim-1" },
      { id: "ev4", timestamp: "2026-09-06T10:00:00.000Z", title: "AIS position", nature: "observed", source: "AisHub feed", provenance_id: null },
    ] });
    fireEvent.change(within(c2).getByLabelText("Investigation timeline"), { target: { value: String(Date.parse("2026-09-06T12:00:00.000Z")) } });
    const cctvLink = Array.from(c2.querySelectorAll("a")).find((a) => a.textContent?.includes("view CCTV evidence"));
    expect(cctvLink).toBeTruthy(); // CCTV provenance navigates to the CCTV evidence route
    const docLink = Array.from(c2.querySelectorAll("a")).find((a) => a.textContent?.includes("view case documents"));
    expect(docLink).toBeTruthy(); // extracted-claim provenance navigates to the documents route
    const feedLink = Array.from(c2.querySelectorAll("a")).find((a) => a.textContent?.includes("AisHub feed"));
    expect(feedLink).toBeFalsy(); // plain provider text is never rendered as a link
    dumpPage(container, "map-page-tracked.html");
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
    dumpPage(container, "map-page-zoomed.html");
  });

  it("long gap in the record: no marker, no implied route, explicit gap state", () => {
    const far = { ...fix2, observed_at: "2026-09-02T16:00:00.000Z" };
    const { container, getByLabelText } = renderMap({ ...base, observations: [fix1, far], timeline: [event] });
    fireEvent.change(getByLabelText("Investigation timeline"), { target: { value: String(Date.parse("2026-09-02T12:00:00.000Z")) } });
    const svg = container.querySelector("svg")!;
    expect(svg.querySelector("animate")).toBeNull(); // no marker inside an unsupported gap
    expect(container.textContent).toContain("POSITION GAP 08:00Z-16:00Z · NO RECORDED POSITIONS IN THIS WINDOW");
    expect(container.textContent).toContain("GAP - NO RECORDED DATA");
    expect(container.textContent).toContain("NO RECORDED POSITION AT THIS TIME"); // no follow/tracking implication inside a gap
    const follow = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("No position to follow"));
    expect(follow).toBeTruthy();
    expect((follow as HTMLButtonElement).disabled).toBe(true); // cannot follow what is not recorded
    const polylines = svg.querySelectorAll('g[filter="url(#hud-glow)"] > polyline');
    expect(polylines.length).toBe(2); // track broken into segments, no line across the gap
    dumpPage(container, "map-page-gap.html");
  });

  it("no temporal evidence at all: playback replaced by a plain no-play state", () => {
    const { container, queryByText } = renderMap({ ...base, observations: [], timeline: [] });
    expect(queryByText("Play timeline")).toBeNull();
    expect(container.textContent).toContain("no recorded positions, satellite passes or case events yet");
  });

  it("interaction renders: full screen keeps overlays readable; playing state advances the clock", () => {
    const { container, getByText } = renderMap({ ...base, observations: [fix1, fix2], timeline: [event] });
    fireEvent.click(getByText("Full screen"));
    const stage = container.querySelector("div.fixed.inset-0");
    expect(stage).not.toBeNull(); // true full-screen stage
    expect(container.textContent).toContain("Close full screen");
    expect(container.textContent).toContain("DUR-2026-0412 · MV Umhlanga Trader · voyage 214S · Container MSKU7748213"); // overlay still present
    dumpPage(container, "map-page-fullscreen.html");
    fireEvent.click(getByText("Close full screen"));
    expect(container.querySelector("div.fixed.inset-0")).toBeNull();

    vi.useFakeTimers();
    fireEvent.click(getByText("Play timeline"));
    expect(getByText("Pause")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1000); }); // several playback ticks
    dumpPage(container, "map-page-playing.html");
    fireEvent.click(getByText("Pause"));
  });
});
