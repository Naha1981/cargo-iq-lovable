import { describe, expect, it } from "vitest";
import {
  aisTrack, clampZoom, interpolateTrack, mapCoverageLine, project,
  vesselIdentityLine, viewBoxString, zoomViewBox, MAP_CANVAS, ZOOM_MAX, ZOOM_MIN,
} from "./harbour-map";

const t0 = "2026-09-02T08:00:00.000Z";
const t1 = "2026-09-02T10:00:00.000Z";
const pt = (at: string, lat: number, lon: number, sog = 5) => ({ at, lat, lon, sog, cog: 90, mmsi: "111", vesselName: "MV TEST" });

describe("aisTrack", () => {
  it("keeps only AIS_POSITION rows with coordinates, sorted by time", () => {
    const track = aisTrack([
      { observation_type: "AIS_POSITION", observed_at: t1, latitude: -29.9, longitude: 31.1, payload: { sog: 3 } },
      { observation_type: "SENTINEL_1_SCENE", observed_at: t0, latitude: -29.8, longitude: 31.0 },
      { observation_type: "AIS_POSITION", observed_at: t0, latitude: -29.8, longitude: 31.0, payload: { sog: 7, cog: 45 } },
      { observation_type: "AIS_POSITION", observed_at: t0, latitude: null, longitude: 31.0 },
      { observation_type: "AIS_POSITION", observed_at: "not-a-date", latitude: -29.7, longitude: 31.2 },
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
    const pos = interpolateTrack([pt(t0, -29.8, 31.0, 4), pt(t1, -29.9, 31.1, 8)], Date.parse(t0) + 3600e3);
    expect(pos!.lat).toBeCloseTo(-29.85);
    expect(pos!.lon).toBeCloseTo(31.05);
    expect(pos!.sog).toBeCloseTo(6);
  });
  it("projects onto the canvas within bounds", () => {
    const pos = interpolateTrack([pt(t0, -29.8833, 31.05)], Date.parse(t0));
    const centre = project(-29.8833, 31.05);
    expect(pos!.x).toBeCloseTo(centre.x);
    expect(pos!.y).toBeCloseTo(centre.y);
  });
});

describe("zoomViewBox", () => {
  it("zoom 1 shows the whole canvas", () => {
    expect(zoomViewBox(1)).toEqual({ x: 0, y: 0, width: MAP_CANVAS.width, height: MAP_CANVAS.height });
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
    expect(viewBoxString(zoomViewBox(3, { x: 500, y: 320 }))).toMatch(/^\d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)?$/);
  });
});

describe("vesselIdentityLine", () => {
  it("combines reference, vessel, voyage and container", () => {
    expect(vesselIdentityLine({ reference_no: "DUR-2026-0412", vessel_name: "MV Umhlanga Trader", voyage_no: "214S", container_no: "MSKU7748213" }))
      .toBe("DUR-2026-0412 · MV Umhlanga Trader · voyage 214S · Container MSKU7748213");
  });
  it("falls back honestly when fields are missing", () => {
    expect(vesselIdentityLine({ reference_no: null, vessel_name: null, voyage_no: null, container_no: null }))
      .toBe("CASE · Unnamed vessel");
    expect(vesselIdentityLine({ reference_no: "X-1", vessel_name: "MV A", voyage_no: null, container_no: null }))
      .toBe("X-1 · MV A");
  });
});

describe("mapCoverageLine", () => {
  it("never claims positions that do not exist", () => {
    expect(mapCoverageLine(true, 5)).toBe("SAMPLE DATA");
    expect(mapCoverageLine(false, 5)).toBe("RECORDED OBSERVATIONS");
    expect(mapCoverageLine(false, 0)).toBe("NO VESSEL POSITIONS RECORDED");
  });
});
