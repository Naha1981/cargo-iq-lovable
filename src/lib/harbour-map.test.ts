import { describe, expect, it } from "vitest";
import {
  aisTrack,
  basisDescription,
  basisLabel,
  clampZoom,
  interpolateTrack,
  mapCoverageLine,
  panBy,
  positionGap,
  project,
  scaleBarPx,
  splitTrackSegments,
  vesselIdentityLine,
  viewBoxString,
  zoomViewBox,
  fitViewBox,
  GEO_WINDOW,
  MAP_CANVAS,
  ZOOM_MAX,
  ZOOM_MIN,
} from "./harbour-map";

const t0 = "2026-09-02T08:00:00.000Z";
const t1 = "2026-09-02T10:00:00.000Z";
const pt = (at: string, lat: number, lon: number, sog = 5) => ({
  at,
  lat,
  lon,
  sog,
  cog: 90,
  mmsi: "111",
  vesselName: "MV TEST",
});

describe("aisTrack", () => {
  it("keeps only AIS_POSITION rows with coordinates, sorted by time", () => {
    const track = aisTrack([
      {
        observation_type: "AIS_POSITION",
        observed_at: t1,
        latitude: -29.9,
        longitude: 31.1,
        payload: { sog: 3 },
      },
      { observation_type: "SENTINEL_1_SCENE", observed_at: t0, latitude: -29.8, longitude: 31.0 },
      {
        observation_type: "AIS_POSITION",
        observed_at: t0,
        latitude: -29.8,
        longitude: 31.0,
        payload: { sog: 7, cog: 45 },
      },
      { observation_type: "AIS_POSITION", observed_at: t0, latitude: null, longitude: 31.0 },
      {
        observation_type: "AIS_POSITION",
        observed_at: "not-a-date",
        latitude: -29.7,
        longitude: 31.2,
      },
    ]);
    expect(track.map((p) => p.at)).toEqual([t0, t1]);
    expect(track[0]).toMatchObject({ sog: 7, cog: 45 });
    expect(track[1]).toMatchObject({ sog: 3 });
  });
  it("returns an empty track for no usable observations", () => {
    expect(aisTrack([])).toEqual([]);
    expect(aisTrack(undefined as any)).toEqual([]);
  });
});

describe("interpolateTrack", () => {
  it("returns null for an empty track - no fabricated position", () => {
    expect(interpolateTrack([], Date.parse(t0))).toBeNull();
  });
  it("returns the single recorded point when only one exists", () => {
    const pos = interpolateTrack([pt(t0, -29.85, 31.02)], Date.parse(t0) + 3600e3);
    expect(pos).not.toBeNull();
    expect(pos!.lat).toBeCloseTo(-29.85);
    expect(pos!.lon).toBeCloseTo(31.02);
    expect(pos!.sog).toBe(5);
  });
  it("interpolates halfway between two points", () => {
    const pos = interpolateTrack(
      [pt(t0, -29.8, 31.0, 4), pt(t1, -29.9, 31.1, 8)],
      Date.parse(t0) + 3600e3,
    );
    expect(pos!.lat).toBeCloseTo(-29.85);
    expect(pos!.lon).toBeCloseTo(31.05);
    expect(pos!.sog).toBeCloseTo(6);
  });
  it("projects real coordinates linearly over the geographic window", () => {
    const cLat = (GEO_WINDOW.latMin + GEO_WINDOW.latMax) / 2;
    const cLon = (GEO_WINDOW.lonMin + GEO_WINDOW.lonMax) / 2;
    const c = project(cLat, cLon);
    expect(c.x).toBeCloseTo(500, 6);
    expect(c.y).toBeCloseTo(320, 6);
    expect(project(GEO_WINDOW.latMax, GEO_WINDOW.lonMin).x).toBeCloseTo(0, 6);
    expect(project(GEO_WINDOW.latMin, GEO_WINDOW.lonMax).y).toBeCloseTo(640, 6);
    // no clamping: off-window points project outside the canvas for the viewBox to crop
    expect(project(GEO_WINDOW.latMax + 0.1, cLon).y).toBeLessThan(0);
  });

  it("scale bar reflects real ground distance", () => {
    const px = scaleBarPx(5000);
    expect(px).toBeGreaterThan(80);
    expect(px).toBeLessThan(140); // ~5 km of a ~47 km-wide window
  });

  it("splitTrackSegments breaks the track at unsupported gaps", () => {
    const segs = splitTrackSegments([
      pt(t0, -29.8, 31.0),
      pt(t1, -29.9, 31.1),
      pt("2026-09-02T16:00:00.000Z", -30.0, 31.2),
    ]);
    expect(segs.length).toBe(2);
    expect(segs[0]!.length).toBe(2);
    expect(segs[1]!.length).toBe(1);
    expect(splitTrackSegments([])).toEqual([]);
  });

  it("panBy clamps the viewBox inside the canvas", () => {
    const vb = { x: 250, y: 160, width: 500, height: 320 };
    expect(panBy(vb, 100, 50)).toEqual({ x: 350, y: 210, width: 500, height: 320 });
    expect(panBy(vb, -999, 999)).toEqual({ x: 0, y: 320, width: 500, height: 320 });
  });
});

describe("interpolateTrack provenance", () => {
  const a = pt(t0, -29.8, 31.0, 4);
  const b = pt(t1, -29.9, 31.1, 8);
  it("marks a position at a recorded fix as a fix", () => {
    expect(interpolateTrack([a, b], Date.parse(t1))!.basis).toEqual({ kind: "fix", at: t1 });
    expect(interpolateTrack([a], Date.parse(t0) + 3600e3)!.basis).toEqual({ kind: "fix", at: t0 });
  });
  it("marks a position between fixes as derived, with gap size", () => {
    const basis = interpolateTrack([a, b], Date.parse(t0) + 3600e3)!.basis;
    expect(basis).toEqual({ kind: "interpolated", from: t0, to: t1, gapHours: 2, longGap: false });
  });
  it("refuses to derive across a long gap and reports the gap instead", () => {
    const far = pt("2026-09-02T16:00:00.000Z", -30.0, 31.2);
    expect(interpolateTrack([a, far], Date.parse(t0) + 4 * 3600e3)).toBeNull(); // no implied route
    expect(positionGap([a, far], Date.parse(t0) + 4 * 3600e3)).toEqual({
      from: t0,
      to: "2026-09-02T16:00:00.000Z",
    });
    expect(positionGap([a, b], Date.parse(t0) + 30 * 60e3)).toBeNull(); // inside the supported 2h segment
    expect(positionGap([a, b], Date.parse(t1))).toBeNull(); // exactly on a fix, not between
  });
  it("marks positions before the first fix and after the last fix instead of pretending currency", () => {
    const early = interpolateTrack([a, b], Date.parse(t0) - 3600e3)!;
    expect(early.basis).toEqual({ kind: "before-first", at: t0 });
    expect(early.lat).toBeCloseTo(-29.8);
    const late = interpolateTrack([a, b], Date.parse(t1) + 3600e3)!;
    expect(late.basis).toEqual({ kind: "stale", at: t1 });
    expect(late.lat).toBeCloseTo(-29.9);
  });
  it("labels each basis honestly", () => {
    expect(basisLabel({ kind: "fix", at: t0 })).toContain("RECORDED AIS FIX");
    expect(
      basisLabel({ kind: "interpolated", from: t0, to: t1, gapHours: 2, longGap: false }),
    ).toContain("DERIVED BETWEEN FIXES");
    expect(
      basisLabel({ kind: "interpolated", from: t0, to: t1, gapHours: 8, longGap: true }),
    ).toContain("LONG GAP");
    expect(basisLabel({ kind: "stale", at: t1 })).toContain("NO NEWER POSITIONS");
    expect(basisLabel({ kind: "before-first", at: t0 })).toContain("NO EARLIER POSITIONS");
    expect(
      basisDescription({ kind: "interpolated", from: t0, to: t1, gapHours: 8, longGap: true }),
    ).toContain("not a direct recording");
    expect(basisDescription({ kind: "stale", at: t1 })).toContain("Last recorded position");
  });
});

describe("zoomViewBox", () => {
  it("zoom 1 shows the whole canvas", () => {
    expect(zoomViewBox(1)).toEqual({
      x: 0,
      y: 0,
      width: MAP_CANVAS.width,
      height: MAP_CANVAS.height,
    });
  });
  it("zoom 2 centres a quarter-area crop on the focus point", () => {
    const vb = zoomViewBox(2, { x: 500, y: 320 });
    expect(vb.width).toBeCloseTo(500);
    expect(vb.height).toBeCloseTo(320);
    expect(vb.x).toBeCloseTo(250);
    expect(vb.y).toBeCloseTo(160);
  });
  it("clamps the crop inside the canvas when the focus is near an edge", () => {
    const vb = zoomViewBox(4, { x: 10, y: 630 });
    expect(vb.x).toBe(0);
    expect(vb.y + vb.height).toBeCloseTo(MAP_CANVAS.height);
    expect(vb.x + vb.width).toBeLessThanOrEqual(MAP_CANVAS.width);
  });
  it("clamps zoom to the allowed range and tolerates non-finite input", () => {
    expect(clampZoom(0)).toBe(ZOOM_MIN);
    expect(clampZoom(100)).toBe(ZOOM_MAX);
    expect(clampZoom(Number.NaN)).toBe(ZOOM_MIN);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(ZOOM_MIN);
    expect(zoomViewBox(100).width).toBeCloseTo(MAP_CANVAS.width / ZOOM_MAX);
  });
  it("serialises to an svg viewBox string", () => {
    expect(viewBoxString({ x: 0, y: 0, width: 1000, height: 640 })).toBe("0 0 1000 640");
    expect(viewBoxString(zoomViewBox(3, { x: 500, y: 320 }))).toMatch(
      /^\d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)?$/,
    );
  });
});

describe("vesselIdentityLine", () => {
  it("combines reference, vessel, voyage and container", () => {
    expect(
      vesselIdentityLine({
        reference_no: "DUR-2026-0412",
        vessel_name: "MV Umhlanga Trader",
        voyage_no: "214S",
        container_no: "MSKU7748213",
      }),
    ).toBe("DUR-2026-0412 · MV Umhlanga Trader · voyage 214S · Container MSKU7748213");
  });
  it("falls back honestly when fields are missing", () => {
    expect(
      vesselIdentityLine({
        reference_no: null,
        vessel_name: null,
        voyage_no: null,
        container_no: null,
      }),
    ).toBe("CASE · Unnamed vessel");
    expect(
      vesselIdentityLine({
        reference_no: "X-1",
        vessel_name: "MV A",
        voyage_no: null,
        container_no: null,
      }),
    ).toBe("X-1 · MV A");
  });
});

describe("mapCoverageLine", () => {
  it("never claims positions that do not exist", () => {
    expect(mapCoverageLine(true, 5)).toBe("SAMPLE DATA");
    expect(mapCoverageLine(false, 5)).toBe("RECORDED OBSERVATIONS");
    expect(mapCoverageLine(false, 0)).toBe("NO VESSEL POSITIONS RECORDED");
  });
});

describe("fitViewBox: viewport-aspect fill", () => {
  it("portrait viewport crops width, fills height, centres on focus", () => {
    const vb = fitViewBox(1, null, 390 / 694);
    expect(vb.height).toBe(640); // full canvas height used
    expect(vb.width).toBeCloseTo(640 * (390 / 694), 1); // width shrunk to viewport aspect
    expect(vb.width / vb.height).toBeCloseTo(390 / 694, 3); // aspect preserved: no distortion
  });
  it("squat landscape crops height, fills width", () => {
    const vb = fitViewBox(1, null, 844 / 240);
    expect(vb.width).toBe(1000);
    expect(vb.height).toBeCloseTo(1000 / (844 / 240), 1);
  });
  it("canvas-aspect viewport matches zoomViewBox", () => {
    const a = fitViewBox(1.5, null, 1000 / 640);
    const b = zoomViewBox(1.5);
    expect(a.width).toBeCloseTo(b.width, 6);
    expect(a.height).toBeCloseTo(b.height, 6);
  });
  it("zoom shrinks the window preserving the viewport aspect", () => {
    const vb = fitViewBox(2, null, 0.5);
    expect(vb.width / vb.height).toBeCloseTo(0.5, 3);
    expect(vb.height).toBeCloseTo(320, 1);
  });
});
