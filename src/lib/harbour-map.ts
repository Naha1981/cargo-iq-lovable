// Pure harbour-map logic: projection, track interpolation, zoom math, and
// source-bound display labels. No DOM, no React - unit-tested in harbour-map.test.ts.

export const MAP_CANVAS = { width: 1000, height: 640 } as const;
/**
 * Geographic window shown at zoom 1: Durban harbour plus offshore anchorage.
 * Sized so one canvas unit is square on the ground (equirectangular at ~29.86S),
 * which keeps the scale bar honest.
 */
export const GEO_WINDOW = {
  lonMin: 30.82,
  lonMax: 31.306,
  latMin: -29.99,
  latMax: -29.72,
} as const;
const WINDOW_WIDTH_KM =
  (GEO_WINDOW.lonMax - GEO_WINDOW.lonMin) * 111.32 * Math.cos((-29.855 * Math.PI) / 180);
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

/** Real geographic projection (equirectangular) over GEO_WINDOW. No clamping:
 *  the svg viewBox crops naturally, and positions must never snap to fake points. */
export function project(lat: number, lon: number): CanvasPoint {
  const x =
    ((lon - GEO_WINDOW.lonMin) / (GEO_WINDOW.lonMax - GEO_WINDOW.lonMin)) * MAP_CANVAS.width;
  const y =
    ((GEO_WINDOW.latMax - lat) / (GEO_WINDOW.latMax - GEO_WINDOW.latMin)) * MAP_CANVAS.height;
  return { x, y };
}

/** Pixel width of a ground-distance scale bar at the map's latitude. */
export function scaleBarPx(meters: number): number {
  return (meters / 1000 / WINDOW_WIDTH_KM) * MAP_CANVAS.width;
}

/** Parse AIS_POSITION observations into an ordered vessel track. */
export function aisTrack(observations: any[]): TrackPoint[] {
  return (observations ?? [])
    .filter(
      (x) => x.observation_type === "AIS_POSITION" && x.latitude != null && x.longitude != null,
    )
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
    lat = a.lat;
    lon = a.lon;
    sog = a.sog;
    cog = a.cog;
  } else if (Math.abs(time - tb) <= FIX_TOLERANCE_MS) {
    basis = { kind: "fix", at: at(b) };
    lat = b.lat;
    lon = b.lon;
    sog = b.sog;
    cog = b.cog;
  } else if (time < ta) {
    basis = { kind: "before-first", at: at(a) };
    lat = a.lat;
    lon = a.lon;
    sog = a.sog;
    cog = a.cog;
  } else if (time > tb) {
    basis = { kind: "stale", at: at(b) };
    lat = b.lat;
    lon = b.lon;
    sog = b.sog;
    cog = b.cog;
  } else {
    const gapHours = (tb - ta) / 3600000;
    if (gapHours > LONG_GAP_HOURS) return null; // unsupported window: no marker, no derived position
    const f = Math.max(0, Math.min(1, (time - ta) / (tb - ta)));
    basis = { kind: "interpolated", from: at(a), to: at(b), gapHours, longGap: false };
    lat = a.lat + (b.lat - a.lat) * f;
    lon = a.lon + (b.lon - a.lon) * f;
    sog = a.sog + (b.sog - a.sog) * f;
    cog = a.cog ?? b.cog;
  }
  const { x, y } = project(lat, lon);
  return { lat, lon, sog, cog, x, y, basis };
}

/** The unsupported window containing time, when fixes are too far apart to derive across. */
export function positionGap(
  track: TrackPoint[],
  time: number,
): { from: string; to: string } | null {
  for (let i = 1; i < track.length; i++) {
    const ta = Date.parse(track[i - 1]!.at);
    const tb = Date.parse(track[i]!.at);
    if (time > ta && time < tb && (tb - ta) / 3600000 > LONG_GAP_HOURS) {
      return { from: track[i - 1]!.at, to: track[i]!.at };
    }
  }
  return null;
}

/** Track broken at unsupported gaps so no line implies a traversed route across one. */
export function splitTrackSegments(track: TrackPoint[]): TrackPoint[][] {
  const segments: TrackPoint[][] = [];
  let current: TrackPoint[] = [];
  for (const p of track) {
    const prev = current[current.length - 1];
    if (prev && (Date.parse(p.at) - Date.parse(prev.at)) / 3600000 > LONG_GAP_HOURS) {
      segments.push(current);
      current = [];
    }
    current.push(p);
  }
  if (current.length) segments.push(current);
  return segments;
}

/** Pan a viewBox by canvas units, clamped inside the canvas. */
export function panBy(vb: ViewBox, dx: number, dy: number): ViewBox {
  return {
    ...vb,
    x: Math.min(Math.max(vb.x + dx, 0), MAP_CANVAS.width - vb.width),
    y: Math.min(Math.max(vb.y + dy, 0), MAP_CANVAS.height - vb.height),
  };
}

/** Short canvas label for a position's provenance. */
export function basisLabel(basis: PositionBasis): string {
  const hm = (iso: string) => iso.slice(11, 16) + "Z";
  switch (basis.kind) {
    case "fix":
      return "RECORDED AIS FIX " + hm(basis.at);
    case "interpolated":
      return (
        "DERIVED BETWEEN FIXES " +
        hm(basis.from) +
        "-" +
        hm(basis.to) +
        (basis.longGap ? " · LONG GAP - APPROXIMATE" : "")
      );
    case "stale":
      return "LAST RECORDED " + hm(basis.at) + " - NO NEWER POSITIONS";
    case "before-first":
      return "FIRST RECORDED " + hm(basis.at) + " - NO EARLIER POSITIONS";
  }
}

/** Plain-language provenance for the preview card. */
export function basisDescription(basis: PositionBasis): string {
  const full = (iso: string) => iso.replace("T", " ").slice(0, 16) + "Z";
  switch (basis.kind) {
    case "fix":
      return "Recorded by AIS at " + full(basis.at);
    case "interpolated":
      return (
        "Derived between recorded fixes " +
        full(basis.from) +
        " and " +
        full(basis.to) +
        " - not a direct recording" +
        (basis.longGap
          ? "; spans a " + Math.round(basis.gapHours) + "-hour gap, treat as approximate"
          : "")
      );
    case "stale":
      return "Last recorded position (" + full(basis.at) + ") - no newer positions";
    case "before-first":
      return "First recorded position (" + full(basis.at) + ") - no earlier positions";
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

/**
 * Viewport-aspect-aware viewBox: the largest canvas window that matches the
 * viewport's aspect ratio, so a portrait or squat viewport is filled instead of
 * letterboxed with dead space. Centered on the focus point, clamped inside the
 * canvas. Zoom shrinks the window preserving the viewport aspect. Geographic
 * scale stays uniform because the window aspect equals the element aspect.
 */
export function fitViewBox(
  zoom: number,
  focus: CanvasPoint | null | undefined,
  aspect: number,
): ViewBox {
  const z = clampZoom(zoom);
  const canvasAspect = MAP_CANVAS.width / MAP_CANVAS.height;
  let width: number;
  let height: number;
  if (!(aspect > 0) || !Number.isFinite(aspect) || Math.abs(aspect - canvasAspect) < 1e-6) {
    width = MAP_CANVAS.width;
    height = MAP_CANVAS.height;
  } else if (aspect > canvasAspect) {
    width = MAP_CANVAS.width;
    height = width / aspect;
  } else {
    height = MAP_CANVAS.height;
    width = height * aspect;
  }
  width /= z;
  height /= z;
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
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Honest data-status line: never claims coverage the case does not have. */
export function mapCoverageLine(isSample: boolean, trackCount: number): string {
  if (isSample) return "SAMPLE DATA";
  if (trackCount > 0) return "RECORDED OBSERVATIONS";
  return "NO VESSEL POSITIONS RECORDED";
}
