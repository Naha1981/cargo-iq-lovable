import { useCallback, useEffect, useRef, useState } from "react";
import { Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { MapLibreOverlay } from "@deck.gl/maplibre";
import { PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { Panel, Button } from "@/components/ui-kit";
import { listCaseRiskTimeline } from "@/lib/risk-events.functions";
import {
  N3_CORRIDOR,
  SA_REFERENCE_POINTS,
  formatAge,
  freshness,
  graticulePaths,
  metersPerPixel,
  niceScaleWidth,
  positionBanner,
  riskEventToPoint,
  timelineEventToPoint,
  candidateAisRecords,
  type CorridorEvent,
  type CorridorPoint,
} from "@/lib/corridor";
import type { Database } from "@/integrations/supabase/types";

type RiskEventRow = Database["public"]["Tables"]["risk_events"]["Row"];
type LinkRow = Database["public"]["Tables"]["risk_event_case_links"]["Row"] & {
  risk_events?: RiskEventRow | null;
};

const STATE_COLOURS: Record<string, [number, number, number]> = {
  observed: [16, 185, 129],
  derived: [100, 116, 139],
  inferred: [245, 158, 11],
  unknown: [239, 68, 68],
};

// No external basemap tiles by default: a plain background keeps the map free of
// tile-usage-policy and load-limit obligations. OSM raster stays behind an
// explicit env opt-in after usage-policy verification.
const PLAIN_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b1220" } }],
} as const;

// Pure presentational map: renders exactly the events it is given. Data fetching
// lives in CorridorView so this can be rendered and verified independently.
export function CorridorMap({
  events,
  portCode,
  fixtureLabel,
}: {
  events: CorridorEvent[];
  portCode: string | null;
  /** When set, a visible badge marks everything on screen as synthetic demo data. */
  fixtureLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<MapLibreOverlay | null>(null);
  const [selected, setSelected] = useState<CorridorEvent | null>(null);
  const eventsRef = useRef<CorridorEvent[]>(events);
  eventsRef.current = events;
  const [is3D, setIs3D] = useState(false);
  const [layersOn, setLayersOn] = useState({
    ports: true,
    events: true,
    corridor: true,
    grid: true,
    vesselRecords: true,
  });
  const [scale, setScale] = useState<{ meters: number; label: string; px: number } | null>(null);
  const [dense, setDense] = useState(false);
  const [nowMs] = useState(() => Date.now());

  const positions: CorridorPoint[] = [];
  const banner = events.some((e) => e.recordKind === "ais_position")
    ? "Archived AIS records available below. No verified live shipment position."
    : positionBanner(positions, nowMs);
  const bannerIsFresh = false;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: PLAIN_STYLE as never,
      center: [28.5, -29.5],
      zoom: 4.6,
      pitch: is3D ? 45 : 0,
      dragRotate: false, // keep the north indicator honest
      bearing: 0,
    });
    map.on("load", () => {
      const el = containerRef.current;
      const narrow = !!el && el.clientWidth < 640;
      setDense(narrow);
      // Adaptive framing: on narrow screens with real events, fit the events so
      // labels spread; otherwise fit the reference network.
      const pts = [
        ...SA_REFERENCE_POINTS.map((p) => [p.longitude, p.latitude]),
        ...N3_CORRIDOR,
        ...eventsRef.current.map((e) => [e.longitude, e.latitude]),
      ];
      const lons = pts.map((p) => p[0]);
      const lats = pts.map((p) => p[1]);
      map.fitBounds(
        [
          [Math.min(...lons) - 1.2, Math.min(...lats) - 1.2],
          [Math.max(...lons) + 1.2, Math.max(...lats) + 1.2],
        ],
        { padding: narrow ? 60 : 72, pitch: 0, duration: 0 },
      );
    });
    const updateScale = () => {
      const c = map.getCenter();
      const mpp = metersPerPixel(c.lat, map.getZoom());
      const s = niceScaleWidth(mpp);
      setScale({ ...s, px: s.meters / mpp });
    };
    map.on("moveend", updateScale);
    updateScale();
    const overlay = new MapLibreOverlay({ interleaved: true, layers: [] });
    map.addControl(overlay as never);
    mapRef.current = map;
    overlayRef.current = overlay;
    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    mapRef.current?.easeTo({ pitch: is3D ? 45 : 0, duration: 300 });
  }, [is3D]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const ports = SA_REFERENCE_POINTS.map((p) => ({
      position: [p.longitude, p.latitude] as [number, number],
      colour: STATE_COLOURS.derived,
      radius: 8,
    }));
    const eventPoints = events
      .filter((e) => e.recordKind !== "ais_position")
      .map((e) => ({
        position: [e.longitude, e.latitude] as [number, number],
        colour: STATE_COLOURS[e.state] ?? STATE_COLOURS.unknown,
        radius: 6,
        event: e,
      }));
    overlay.setProps({
      layers: [
        ...(layersOn.grid
          ? [
              new PathLayer({
                id: "graticule",
                data: graticulePaths().map((path) => ({ path })),
                getPath: (d) => d.path,
                getColor: [148, 163, 184, 70],
                getWidth: 1,
                widthUnits: "pixels",
              }),
            ]
          : []),
        ...(layersOn.corridor
          ? [
              new PathLayer({
                id: "n3-corridor",
                data: [{ path: N3_CORRIDOR }],
                getPath: (d) => d.path,
                getColor: [59, 130, 246, 160],
                getWidth: 4,
                widthUnits: "pixels",
              }),
              ...(dense
                ? []
                : [
                    new TextLayer({
                      id: "n3-label",
                      data: [
                        {
                          position: [29.2, -29.0] as [number, number],
                          text: "N3 corridor (illustrative, derived)",
                        },
                      ],
                      getPosition: (d) => d.position,
                      getText: (d) => d.text,
                      getSize: 13,
                      getColor: [147, 197, 253, 220],
                      fontFamily: "sans-serif",
                    }),
                  ]),
            ]
          : []),
        ...(layersOn.ports
          ? [
              new ScatterplotLayer({
                id: "ports",
                data: ports,
                getPosition: (d) => d.position,
                getFillColor: (d) => [...d.colour, 220] as never,
                getRadius: (d) => d.radius,
                radiusUnits: "pixels",
              }),
              new TextLayer({
                id: "port-labels",
                data: SA_REFERENCE_POINTS.map((p) => ({
                  position: [p.longitude, p.latitude] as [number, number],
                  text: dense
                    ? ({
                        "ref-durban-port": "DUR",
                        "ref-cape-town-port": "CPT",
                        "ref-ngqura-port": "NGQ",
                        "ref-richards-bay-port": "RCB",
                        "ref-johannesburg": "JHB",
                        "ref-beitbridge": "BBR",
                        "ref-maputo": "MPM",
                      }[p.id] ?? p.label)
                    : p.label,
                  // Manual de-collision: offsets chosen per point to avoid overlaps
                  // at the fitted extent (no collision extension dependency).
                  offset:
                    p.id === "ref-ngqura-port"
                      ? [0, -16]
                      : p.id === "ref-richards-bay-port"
                        ? [0, -16]
                        : p.id === "ref-durban-port"
                          ? [0, 16]
                          : [0, 14],
                })),
                getPosition: (d) => d.position,
                getText: (d) => d.text,
                getSize: dense ? 10 : 12,
                getColor: [226, 232, 240, 255],
                getPixelOffset: (d) => d.offset as [number, number],
                fontFamily: "sans-serif",
              }),
            ]
          : []),
        ...(layersOn.vesselRecords
          ? [
              new ScatterplotLayer({
                id: "recorded-ais-positions",
                data: events
                  .filter((e) => e.recordKind === "ais_position")
                  .map((e) => ({
                    position: [e.longitude, e.latitude] as [number, number],
                    event: e,
                  })),
                getPosition: (d) => d.position,
                getFillColor: [168, 85, 247, 200],
                getLineColor: [255, 255, 255, 255],
                stroked: true,
                lineWidthMinPixels: 1,
                getRadius: 8,
                radiusUnits: "pixels",
                pickable: true,
                onClick: (info) => {
                  const e = (info.object as { event?: CorridorEvent } | undefined)?.event;
                  if (e) setSelected(e);
                },
              }),
            ]
          : []),
        ...(layersOn.events
          ? [
              new ScatterplotLayer({
                id: "risk-events",
                data: eventPoints,
                getPosition: (d) => d.position,
                getFillColor: (d) => [...d.colour, 230] as never,
                getRadius: (d) => d.radius,
                radiusUnits: "pixels",
                pickable: true,
                onClick: (info) => {
                  const e = (info.object as { event?: CorridorEvent } | undefined)?.event;
                  if (e) setSelected(e);
                },
              }),
            ]
          : []),
      ],
    });
  }, [events, layersOn, dense]);

  return (
    <div className="space-y-4">
      <Panel title="Logistics Corridor">
        <p
          className={`mb-3 rounded px-2 py-1 text-xs ${bannerIsFresh ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}
        >
          {banner} {portCode ? "Case port: " + portCode + "." : ""}
        </p>
        {events.some((e) => e.recordKind === "ais_position") && (
          <p className="mb-3 rounded border border-purple-400/50 p-2 text-xs text-purple-300">
            Purple markers are candidate archived AIS records with matching recorded vessel names.
            Name equality does not verify identity. They are not a live position feed. Timestamp is
            the stored observation time; original transmitter timing and identity are not
            independently verified. No route is inferred between records.
          </p>
        )}
        {fixtureLabel && (
          <p className="mb-3 rounded bg-amber-500/20 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-amber-400">
            {fixtureLabel}
          </p>
        )}
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-3 text-[11px]">
            {Object.entries(STATE_COLOURS).map(([s, c]) => (
              <span key={s} className="flex items-center gap-1">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: `rgb(${c.join(",")})` }}
                />
                {s}
              </span>
            ))}
          </div>
          <Button onClick={() => setIs3D((v) => !v)}>
            {is3D ? "Switch to 2D" : "Switch to 3D"}
          </Button>
        </div>
        <div className="mb-2 flex flex-wrap gap-3 text-[11px]" aria-label="Layer controls">
          {(Object.keys(layersOn) as (keyof typeof layersOn)[]).map((k) => (
            <label key={k} className="flex cursor-pointer items-center gap-1">
              <input
                type="checkbox"
                checked={layersOn[k]}
                onChange={() => setLayersOn((s) => ({ ...s, [k]: !s[k] }))}
              />
              {k === "vesselRecords" ? "Archived vessel records" : k}
            </label>
          ))}
        </div>
        <div className="relative">
          <div
            ref={containerRef}
            className="h-[480px] w-full rounded border"
            role="application"
            aria-label="Logistics corridor map"
          />
          <div
            className="pointer-events-none absolute right-2 top-2 rounded bg-black/50 px-2 py-1 text-[10px] font-bold text-white"
            aria-hidden
          >
            ▲ N
          </div>
          {scale && (
            <div
              className="pointer-events-none absolute bottom-6 left-2 rounded bg-black/50 px-2 py-1 text-[10px] text-white"
              aria-hidden
            >
              <div className="mx-auto border-b-2 border-white" style={{ width: scale.px }} />
              <div className="mt-0.5 text-center">{scale.label}</div>
            </div>
          )}
        </div>
        {dense && (
          <p className="mt-2 text-xs text-muted-foreground">
            Reference places: DUR Durban · CPT Cape Town · NGQ Ngqura · RCB Richards Bay · JHB
            Johannesburg · BBR Beitbridge · MPM Maputo. Reference corridor geometry is illustrative,
            not surveyed.
          </p>
        )}
        {events.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">
            No geolocated risk events recorded for this case. The corridor and port markers shown
            are reference points (state: derived), not live data.
          </p>
        )}
      </Panel>

      {events.length > 0 && (
        <Panel title="Case-linked event timeline">
          <p className="mb-3 text-xs text-muted-foreground">
            Generic events are not tracking fixes. AIS entries are archived reported positions, not
            live. Select a record to inspect its evidence.
          </p>
          <ul className="space-y-2">
            {[...events]
              .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt))
              .map((e) => (
                <li key={e.id}>
                  <button
                    className="w-full rounded border p-2 text-left text-sm"
                    onClick={() => {
                      setSelected(e);
                      mapRef.current?.easeTo({
                        center: [e.longitude, e.latitude],
                        zoom: 8,
                        pitch: 0,
                      });
                      setIs3D(false);
                    }}
                  >
                    {e.title} ·{" "}
                    {e.observedAt
                      ? new Date(e.observedAt).toLocaleString("en-GB")
                      : "observation time not recorded"}{" "}
                    · {e.state}
                  </button>
                </li>
              ))}
          </ul>
        </Panel>
      )}
      {selected && (
        <Panel title={"Evidence: " + selected.title}>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">Evidence state</dt>
            <dd className="font-semibold uppercase">{selected.state}</dd>
            <dt className="text-muted-foreground">
              {selected.recordKind === "ais_position" ? "Stored observation time" : "Observed at"}
            </dt>
            <dd>
              {selected.observedAt
                ? new Date(selected.observedAt).toLocaleString("en-GB")
                : "not recorded"}
            </dd>
            <dt className="text-muted-foreground">Data age</dt>
            <dd>
              {formatAge(nowMs, selected.observedAt)}{" "}
              {selected.recordKind === "ais_position"
                ? "(stored record age only; position freshness unverified)"
                : "(" + freshness(nowMs, selected.observedAt) + ")"}
            </dd>
            <dt className="text-muted-foreground">Severity</dt>
            <dd>{selected.severity}</dd>
            <dt className="text-muted-foreground">Source</dt>
            <dd className="break-words">{selected.source}</dd>
            <dt className="text-muted-foreground">Record</dt>
            <dd className="break-all">
              {selected.recordKind ?? "event"}: {selected.id}
            </dd>
            <dt className="text-muted-foreground">Original reference</dt>
            <dd className="break-all">
              {selected.sourceRef ?? selected.provenanceId ?? "not recorded"}
            </dd>
          </dl>
        </Panel>
      )}
    </div>
  );
}

export function CorridorView({
  caseId,
  portCode,
  timeline = [],
  observations = [],
  vesselName = null,
}: {
  caseId: string;
  portCode: string | null;
  timeline?: Database["public"]["Tables"]["timeline_events"]["Row"][];
  observations?: Database["public"]["Tables"]["external_observations"]["Row"][];
  vesselName?: string | null;
}) {
  const [events, setEvents] = useState<CorridorEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await listCaseRiskTimeline({ data: { caseId } });
    const rows = (data.links as LinkRow[])
      .map((l) => l.risk_events)
      .filter((e): e is RiskEventRow => !!e);
    setEvents(rows.map((e) => riskEventToPoint({ ...e })).filter((e): e is CorridorEvent => !!e));
  }, [caseId]);

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [load]);

  const candidateAis = candidateAisRecords(observations, vesselName);
  return (
    <>
      {candidateAis.warning && (
        <p className="mb-3 rounded border border-amber-500/50 p-2 text-xs text-amber-500">
          {candidateAis.warning}
        </p>
      )}
      <CorridorMap
        events={[
          ...events,
          ...timeline.map(timelineEventToPoint).filter((e): e is CorridorEvent => !!e),
          ...candidateAis.points,
        ]}
        portCode={portCode}
      />
      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
