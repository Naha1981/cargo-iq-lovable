// 3D/2D Logistics Corridor Intelligence: honest evidence-state model.
// A position is never presented as "current" unless it is OBSERVED and FRESH.
export type EvidenceState = "observed" | "derived" | "inferred" | "unknown";
export type Freshness = "fresh" | "stale" | "unknown";

export interface CorridorPoint {
  id: string;
  latitude: number;
  longitude: number;
  observedAt: string | null;
  source: string | null;
  state: EvidenceState;
  label: string;
  kind: "shipment_position" | "port" | "corridor_node" | "risk_event";
}

export const FRESH_POSITION_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6h for a "current" claim

export function freshness(
  nowMs: number,
  observedAt: string | null,
  maxAgeMs = FRESH_POSITION_MAX_AGE_MS,
): Freshness {
  if (!observedAt) return "unknown";
  const t = Date.parse(observedAt);
  if (Number.isNaN(t)) return "unknown";
  if (t > nowMs) return "unknown";
  return nowMs - t <= maxAgeMs ? "fresh" : "stale";
}

export type PositionClaim = "observed_fresh" | "last_known" | "no_position";

// Nothing here is ever called "current": a map record is an observation at a
// recorded time, full stop. A live/current claim would need a verified live
// feed, which this feature does not have. Derived/inferred/unknown states and
// stale observations always degrade to last_known.
export function positionClaim(points: CorridorPoint[], nowMs: number): PositionClaim {
  const positions = points.filter((p) => p.kind === "shipment_position");
  if (positions.length === 0) return "no_position";
  const best = positions.reduce((a, b) =>
    (Date.parse(b.observedAt ?? "") || 0) > (Date.parse(a.observedAt ?? "") || 0) ? b : a,
  );
  if (best.state === "observed" && freshness(nowMs, best.observedAt) === "fresh") {
    return "observed_fresh";
  }
  return "last_known";
}

export function formatAge(nowMs: number, observedAt: string): string {
  const ms = nowMs - Date.parse(observedAt);
  if (!Number.isFinite(ms)) return "time unknown";
  if (ms < 0) return "future timestamp - check source";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return mins + " min old";
  const hours = Math.round(mins / 60);
  if (hours < 48) return hours + " h old";
  return Math.round(hours / 24) + " d old";
}

export function positionBanner(points: CorridorPoint[], nowMs: number): string {
  const claim = positionClaim(points, nowMs);
  const positions = points.filter((p) => p.kind === "shipment_position");
  const best = positions.length
    ? positions.reduce((a, b) =>
        (Date.parse(b.observedAt ?? "") || 0) > (Date.parse(a.observedAt ?? "") || 0) ? b : a,
      )
    : null;
  switch (claim) {
    case "observed_fresh":
      return (
        "Last observed position recorded at " +
        new Date(best!.observedAt!).toLocaleString("en-GB") +
        " (" +
        formatAge(nowMs, best!.observedAt!) +
        "). Observation record, not a live feed."
      );
    case "last_known":
      return "LAST KNOWN position only - not a live position. Data is stale, derived, inferred, or unverified.";
    case "no_position":
      return "No recorded position for this shipment.";
  }
}

// Graticule (lat/lon grid) over southern Africa so the tile-free map retains
// orientation and scale context. 1-degree spacing.
export function graticulePaths(): [number, number][][] {
  const paths: [number, number][][] = [];
  for (let lon = 16; lon <= 33; lon++) {
    const line: [number, number][] = [];
    for (let lat = -35; lat <= -21; lat += 0.25) line.push([lon, lat]);
    paths.push(line);
  }
  for (let lat = -35; lat <= -21; lat++) {
    const line: [number, number][] = [];
    for (let lon = 16; lon <= 33; lon += 0.25) line.push([lon, lat]);
    paths.push(line);
  }
  return paths;
}

// Web-mercator meters per pixel at a latitude/zoom (standard slippy-map math).
export function metersPerPixel(latitude: number, zoom: number): number {
  return (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / Math.pow(2, zoom);
}

export function niceScaleWidth(mpp: number, targetPx = 90): { meters: number; label: string } {
  const candidates = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000];
  let best = candidates[0];
  for (const c of candidates) {
    if (c / mpp <= targetPx * 1.6) best = c;
  }
  return { meters: best, label: best >= 1000 ? best / 1000 + " km" : best + " m" };
}

// Reference corridor/place data. state="derived": digitised from public geographic
// knowledge, not a live feed. Used only when no tenant record supplies the point.
export const SA_REFERENCE_POINTS: CorridorPoint[] = [
  {
    id: "ref-durban-port",
    latitude: -29.871,
    longitude: 31.045,
    observedAt: null,
    source: "reference-gazetteer",
    state: "derived",
    label: "Durban Port",
    kind: "port",
  },
  {
    id: "ref-cape-town-port",
    latitude: -33.907,
    longitude: 18.423,
    observedAt: null,
    source: "reference-gazetteer",
    state: "derived",
    label: "Cape Town Port",
    kind: "port",
  },
  {
    id: "ref-ngqura-port",
    latitude: -33.809,
    longitude: 25.686,
    observedAt: null,
    source: "reference-gazetteer",
    state: "derived",
    label: "Ngqura (Gqeberha)",
    kind: "port",
  },
  {
    id: "ref-richards-bay-port",
    latitude: -28.792,
    longitude: 32.084,
    observedAt: null,
    source: "reference-gazetteer",
    state: "derived",
    label: "Richards Bay",
    kind: "port",
  },
  {
    id: "ref-johannesburg",
    latitude: -26.204,
    longitude: 28.047,
    observedAt: null,
    source: "reference-gazetteer",
    state: "derived",
    label: "Johannesburg freight hub",
    kind: "corridor_node",
  },
  {
    id: "ref-beitbridge",
    latitude: -22.217,
    longitude: 29.987,
    observedAt: null,
    source: "reference-gazetteer",
    state: "derived",
    label: "Beitbridge border",
    kind: "corridor_node",
  },
  {
    id: "ref-maputo",
    latitude: -25.966,
    longitude: 32.573,
    observedAt: null,
    source: "reference-gazetteer",
    state: "derived",
    label: "Maputo Port",
    kind: "port",
  },
];

// N3 Durban->Johannesburg, ILLUSTRATIVE waypoints (state="derived"). Not surveyed
// geometry; the UI labels it as illustrative, never as the real road path.
export const N3_CORRIDOR: [number, number][] = [
  [31.045, -29.871],
  [30.392, -29.601],
  [29.468, -29.601],
  [28.716, -28.238],
  [27.869, -26.714],
  [28.047, -26.204],
].map(([lon, lat]) => [lon, lat] as [number, number]);

export interface CorridorEvent {
  id: string;
  latitude: number;
  longitude: number;
  observedAt: string;
  source: string;
  state: EvidenceState;
  severity: string;
  title: string;
  sourceRef?: string | null;
  recordKind?: "risk_event" | "timeline_event" | "ais_position";
  provenanceId?: string | null;
}

export function riskEventToPoint(e: {
  id: string;
  latitude: number | null;
  longitude: number | null;
  observed_at: string;
  source: string;
  verification_status: string;
  severity?: string;
  title: string;
  source_ref?: string | null;
}): CorridorEvent | null {
  if (
    e.latitude == null ||
    e.longitude == null ||
    !Number.isFinite(e.latitude) ||
    !Number.isFinite(e.longitude) ||
    Math.abs(e.latitude) > 90 ||
    Math.abs(e.longitude) > 180
  )
    return null;
  const state: EvidenceState =
    e.verification_status === "confirmed"
      ? "observed"
      : e.verification_status === "suspected" || e.verification_status === "under_investigation"
        ? "inferred"
        : "unknown";
  return {
    id: e.id,
    latitude: e.latitude,
    longitude: e.longitude,
    observedAt: e.observed_at,
    source: e.source,
    state,
    severity: e.severity ?? "info",
    title: e.title,
    sourceRef: e.source_ref ?? null,
    recordKind: "risk_event",
  };
}

// Generic geolocated timeline records are event coordinates only. Even an
// observed event is not promoted to a vessel/vehicle tracking fix.
export function timelineEventToPoint(e: {
  id: string;
  title: string;
  timestamp: string;
  source: string | null;
  nature: string;
  coordinates: unknown;
  provenance_id?: string | null;
}): CorridorEvent | null {
  const c = e.coordinates as {
    lat?: unknown;
    lon?: unknown;
    latitude?: unknown;
    longitude?: unknown;
  } | null;
  const latitude = c?.lat ?? c?.latitude,
    longitude = c?.lon ?? c?.longitude;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return null;
  return {
    id: "timeline:" + e.id,
    title: e.title,
    observedAt: e.timestamp,
    latitude,
    longitude,
    source: e.source ?? "not recorded",
    state:
      e.nature === "observed"
        ? "observed"
        : e.nature === "derived"
          ? "derived"
          : e.nature === "inferred"
            ? "inferred"
            : "unknown",
    severity: "not assessed",
    recordKind: "timeline_event",
    provenanceId: e.provenance_id,
  };
}

export function recordedAisToPoint(
  o: {
    id: string;
    observation_type: string;
    latitude: number | null;
    longitude: number | null;
    observed_at: string;
    source: string;
    payload: unknown;
  },
  vesselName: string | null,
): CorridorEvent | null {
  if (
    o.observation_type !== "AIS_POSITION" ||
    o.latitude === null ||
    o.longitude === null ||
    !Number.isFinite(o.latitude) ||
    !Number.isFinite(o.longitude) ||
    Math.abs(o.latitude) > 90 ||
    Math.abs(o.longitude) > 180
  )
    return null;
  const p =
    o.payload && typeof o.payload === "object" ? (o.payload as Record<string, unknown>) : {};
  const recordedName = typeof p.vesselName === "string" ? p.vesselName.trim() : null;
  // No port proximity or similar-name guess. A case association alone does not
  // prove that a collected AIS point is for this vessel.
  if (
    !vesselName ||
    !recordedName ||
    recordedName.toLowerCase() !== vesselName.trim().toLowerCase()
  )
    return null;
  return {
    id: "ais:" + o.id,
    latitude: o.latitude,
    longitude: o.longitude,
    observedAt: o.observed_at,
    source: o.source,
    state: "unknown",
    severity: "not assessed",
    title: "Candidate archived AIS: " + recordedName,
    recordKind: "ais_position",
    sourceRef: typeof p.mmsi === "string" ? "MMSI " + p.mmsi : null,
  };
}

// Same-name records can identify multiple vessels. Without a case-bound MMSI,
// refuse the entire ambiguous name group rather than choosing one silently.
export function candidateAisRecords(
  observations: Parameters<typeof recordedAisToPoint>[0][],
  vesselName: string | null,
) {
  const candidates = observations
    .map((o) => recordedAisToPoint(o, vesselName))
    .filter((p): p is CorridorEvent => !!p);
  const identifiers = new Set(candidates.map((p) => p.sourceRef).filter(Boolean));
  return identifiers.size > 1
    ? {
        points: [] as CorridorEvent[],
        warning:
          "Same recorded vessel name has multiple MMSIs. Candidate AIS markers withheld until a case-bound stable identifier resolves identity.",
      }
    : {
        points: candidates,
        warning: candidates.length
          ? "Name match is a candidate association only, not verified vessel or shipment identity."
          : null,
      };
}
