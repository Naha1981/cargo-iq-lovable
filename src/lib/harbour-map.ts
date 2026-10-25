// Pure harbour-map logic: projection, track interpolation, zoom math, and
// source-bound display labels. No DOM, no React - unit-tested in harbour-map.test.ts.

export const MAP_CANVAS = { width: 1000, height: 640 } as const;
export const DURBAN = { lat: -29.8833, lon: 31.05 } as const;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 8;

export type TrackPoint = {
  at: string;
  lat: number;
  lon: number;
  sog: number;
  cog: number | null;
  mmsi: string | null;
  vesselName: string | null;
};

export type CanvasPoint = { x: number; y: number };

/** Fixed schematic projection used by the harbour evidence map canvas. */
export function project(lat: number, lon: number): CanvasPoint {
  const x = Math.max(20, Math.min(980, 500 + (lon - DURBAN.lon) * 1600));
  const y = Math.max(20, Math.min(620, 320 - (lat - DURBAN.lat) * 1600));
  return { x, y };
}

/** Parse AIS_POSITION observations into an ordered vessel track. */
export function aisTrack(observations: any[]): TrackPoint[] {
  return (observations ?? [])
    .filter((x) => x.observation_type === "AIS_POSITION" && x.latitude != null && x.longitude != null)
    .map((x) => ({
      at: String(x.observed_at),
      lat: Number(x.latitude),
      lon: Number(x.longitude),
      sog: Number(x.payload?.sog ?? 0),
      cog: x.payload?.cog == null ? null : Number(x.payload.cog),
      mmsi: x.payload?.mmsi ? String(x.payload.mmsi) : null,
      vesselName: x.payload?.vesselName ? String(x.payload.vesselName) : null,
    }))
    .filter((x) => Number.isFinite(Date.parse(x.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export type InterpolatedPosition = {
  lat: number;
  lon: number;
  sog: number;
  cog: number | null;
  x: number;
  y: number;
};

/**
 * Interpolated vessel position at a moment in time.
 * Returns null when the case has NO recorded positions - callers must not
 * render a marker or coordinates in that state. There is deliberately no
 * fallback position: an invented location would fabricate evidence.
 */
export function interpolateTrack(track: TrackPoint[], time: number): InterpolatedPosition | null {
  if (!track.length) return null;
  let a = track[0]!;
  let b = track[track.length - 1]!;
  for (let i = 1; i < track.length; i++) {
    if (Date.parse(track[i]!.at) >= time) {
      a = track[i - 1]!;
      b = track[i]!;
      break;
    }
  }
  const ta = Date.parse(a.at);
  const tb = Date.parse(b.at);
  const f = tb === ta ? 1 : Math.max(0, Math.min(1, (time - ta) / (tb - ta)));
  const lat = a.lat + (b.lat - a.lat) * f;
  const lon = a.lon + (b.lon - a.lon) * f;
  const { x, y } = project(lat, lon);
  return { lat, lon, sog: a.sog + (b.sog - a.sog) * f, cog: a.cog ?? b.cog, x, y };
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return ZOOM_MIN;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

export type ViewBox = { x: number; y: number; width: number; height: number };

/**
 * viewBox for a zoom level, centred on focus (usually the tracked vessel) and
 * clamped inside the canvas so the map never pans into empty space.
 */
export function zoomViewBox(zoom: number, focus?: CanvasPoint | null): ViewBox {
  const z = clampZoom(zoom);
  const width = MAP_CANVAS.width / z;
  const height = MAP_CANVAS.height / z;
  const cx = focus?.x ?? MAP_CANVAS.width / 2;
  const cy = focus?.y ?? MAP_CANVAS.height / 2;
  const x = Math.min(Math.max(cx - width / 2, 0), MAP_CANVAS.width - width);
  const y = Math.min(Math.max(cy - height / 2, 0), MAP_CANVAS.height - height);
  return { x, y, width, height };
}

export function viewBoxString(vb: ViewBox): string {
  const r = (n: number) => Math.round(n * 100) / 100;
  return r(vb.x) + " " + r(vb.y) + " " + r(vb.width) + " " + r(vb.height);
}

export type CaseIdentity = {
  reference_no?: string | null;
  vessel_name?: string | null;
  voyage_no?: string | null;
  container_no?: string | null;
};

/** One-line case/vessel identity rendered on the map canvas itself. */
export function vesselIdentityLine(c: CaseIdentity): string {
  return [
    c.reference_no || "CASE",
    (c.vessel_name || "Unnamed vessel") + (c.voyage_no ? " · voyage " + c.voyage_no : ""),
    c.container_no ? "Container " + c.container_no : null,
  ].filter(Boolean).join(" · ");
}

/** Honest data-status line: never claims coverage the case does not have. */
export function mapCoverageLine(isSample: boolean, trackCount: number): string {
  if (isSample) return "SAMPLE DATA";
  if (trackCount > 0) return "RECORDED OBSERVATIONS";
  return "NO VESSEL POSITIONS RECORDED";
}
