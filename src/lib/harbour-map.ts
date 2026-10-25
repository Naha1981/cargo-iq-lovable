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

/** Interpolations spanning more than this many hours are low confidence. */
export const LONG_GAP_HOURS = 2;
const FIX_TOLERANCE_MS = 60 * 1000;

/**
 * Where a shown position comes from. Only "fix" is a recorded position;
 * everything else is derived and must be labelled as such.
 */
export type PositionBasis =
  | { kind: "fix"; at: string }
  | { kind: "interpolated"; from: string; to: string; gapHours: number; longGap: boolean }
  | { kind: "stale"; at: string }
  | { kind: "before-first"; at: string };

export type SourcedPosition = InterpolatedPosition & { basis: PositionBasis };

/**
 * Vessel position at a moment in time, with honest provenance.
 * Returns null when the case has NO recorded positions - callers must not
 * render a marker or coordinates in that state. There is deliberately no
 * fallback position: an invented location would fabricate evidence.
 */
export function interpolateTrack(track: TrackPoint[], time: number): SourcedPosition | null {
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
  const at = (p: TrackPoint) => p.at;
  let basis: PositionBasis;
  let lat: number;
  let lon: number;
  let sog: number;
  let cog: number | null;
  if (Math.abs(time - ta) <= FIX_TOLERANCE_MS || ta === tb) {
    basis = { kind: "fix", at: at(a) };
    lat = a.lat; lon = a.lon; sog = a.sog; cog = a.cog;
  } else if (Math.abs(time - tb) <= FIX_TOLERANCE_MS) {
    basis = { kind: "fix", at: at(b) };
    lat = b.lat; lon = b.lon; sog = b.sog; cog = b.cog;
  } else if (time < ta) {
    basis = { kind: "before-first", at: at(a) };
    lat = a.lat; lon = a.lon; sog = a.sog; cog = a.cog;
  } else if (time > tb) {
    basis = { kind: "stale", at: at(b) };
    lat = b.lat; lon = b.lon; sog = b.sog; cog = b.cog;
  } else {
    const f = Math.max(0, Math.min(1, (time - ta) / (tb - ta)));
    const gapHours = (tb - ta) / 3600000;
    basis = { kind: "interpolated", from: at(a), to: at(b), gapHours, longGap: gapHours > LONG_GAP_HOURS };
    lat = a.lat + (b.lat - a.lat) * f;
    lon = a.lon + (b.lon - a.lon) * f;
    sog = a.sog + (b.sog - a.sog) * f;
    cog = a.cog ?? b.cog;
  }
  const { x, y } = project(lat, lon);
  return { lat, lon, sog, cog, x, y, basis };
}

/** Short canvas label for a position's provenance. */
export function basisLabel(basis: PositionBasis): string {
  const hm = (iso: string) => iso.slice(11, 16) + "Z";
  switch (basis.kind) {
    case "fix": return "RECORDED AIS FIX " + hm(basis.at);
    case "interpolated": return "DERIVED BETWEEN FIXES " + hm(basis.from) + "-" + hm(basis.to) + (basis.longGap ? " · LONG GAP - APPROXIMATE" : "");
    case "stale": return "LAST RECORDED " + hm(basis.at) + " - NO NEWER POSITIONS";
    case "before-first": return "FIRST RECORDED " + hm(basis.at) + " - NO EARLIER POSITIONS";
  }
}

/** Plain-language provenance for the preview card. */
export function basisDescription(basis: PositionBasis): string {
  const full = (iso: string) => iso.replace("T", " ").slice(0, 16) + "Z";
  switch (basis.kind) {
    case "fix": return "Recorded by AIS at " + full(basis.at);
    case "interpolated":
      return "Derived between recorded fixes " + full(basis.from) + " and " + full(basis.to) + " - not a direct recording"
        + (basis.longGap ? "; spans a " + Math.round(basis.gapHours) + "-hour gap, treat as approximate" : "");
    case "stale": return "Last recorded position (" + full(basis.at) + ") - no newer positions";
    case "before-first": return "First recorded position (" + full(basis.at) + ") - no earlier positions";
  }
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
