import { Route as CaseRoute } from "./cases.$caseId";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, DisputeBadge, NatureBadge, Panel } from "@/components/ui-kit";
import { corroborateCase } from "@/lib/case.functions";
import { addMapSnapshot } from "@/lib/map-snapshot.functions";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { disputedClaimIds, disputedWindow, isDisputeEvent } from "@/lib/dispute";

import { aisTrack, basisDescription, basisLabel, clampZoom, interpolateTrack, mapCoverageLine, panBy, positionGap, project, scaleBarPx, splitTrackSegments, vesselIdentityLine, viewBoxString, zoomViewBox, type PositionBasis, type TrackPoint, type ViewBox } from "@/lib/harbour-map";
import { DURBAN_COASTLINE } from "@/lib/durban-coastline";

export const Route = createFileRoute("/cases/$caseId/map")({
  head: () => ({ meta: [{ title: "Harbour Evidence Map | CargoIQ" }] }),
  component: MapPage,
});

export function MapPage() {
  const { caseId } = Route.useParams();
  const data = CaseRoute.useLoaderData();
  const router = useRouter();

  const isSample = data.documents.some((document: any) => document.file_path?.startsWith("demo/"));
  const track = aisTrack(data.observations);
  const scenes = data.observations.filter((x: any) => String(x.observation_type).includes("SENTINEL"));
  const marine = data.observations.filter((x: any) => x.observation_type === "MARINE_WEATHER");

  const times = [
    ...track.map((x) => Date.parse(x.at)),
    ...scenes.map((x: any) => Date.parse(String(x.observed_at))),
    ...data.timeline.map((x: any) => Date.parse(x.timestamp)),
  ].filter(Number.isFinite);

  const hasTemporalEvidence = times.length > 0;
  const initialTime = times.length ? Math.min(...times) : Date.now();
  const maxTime = times.length ? Math.max(...times, initialTime + 3600000) : initialTime + 24 * 3600000;

  const [time, setTime] = useState(initialTime);
  const [playing, setPlaying] = useState(false);
  const [locked, setLocked] = useState(true);
  const [layers, setLayers] = useState({ ais: true, infrastructure: true });
  const [refreshing, setRefreshing] = useState(false);
  const [large, setLarge] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ px: number; py: number; panX: number; panY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [saving, setSaving] = useState(false);
  const [snapshotNotice, setSnapshotNotice] = useState("");
  const [snapshotError, setSnapshotError] = useState("");
  const stageRef = useRef<HTMLDivElement | null>(null);
  const supabase = createClient();
  type Preview =
    | { kind: "vessel" }
    | { kind: "position"; p: TrackPoint }
    | { kind: "terminal"; name: string; covers: string }
    | { kind: "sar" | "optical"; scene: any }
    | { kind: "weather"; w: any };
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pinned, setPinned] = useState(false);
  const showPreview = (next: Preview) => { if (!pinned) setPreview(next); };
  const tapPreview = (next: Preview) => { setPreview(next); setPinned(true); };
  const clearPreview = () => { setPreview(null); setPinned(false); };
  const hoverOut = () => { if (!pinned) setPreview(null); };

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setTime((value) => value >= maxTime ? initialTime : value + 15 * 60 * 1000);
    }, 120);
    return () => window.clearInterval(id);
  }, [playing, initialTime, maxTime]);

  // null when the case has no recorded positions: never render an invented location.
  const pos = useMemo(() => interpolateTrack(track, time), [track, time]);
  const gap = useMemo(() => positionGap(track, time), [track, time]);
  const segments = useMemo(() => splitTrackSegments(track), [track]);
  const focus = pos && locked ? { x: pos.x, y: pos.y } : null;
  const vbObj = panBy(zoomViewBox(zoom, focus), pan.x, pan.y);
  const vb = viewBoxString(vbObj);
  const coast = useMemo(() => DURBAN_COASTLINE.map((chain) => chain.map(([lon, lat]) => project(lat, lon))), []);
  const landPath = useMemo(() => coast.map((chain) => {
    const first = chain[0]!;
    const last = chain[chain.length - 1]!;
    // close along the west (landward) edge of the canvas
    return "M" + first.x + " " + first.y + " " + chain.map((p) => "L" + p.x + " " + p.y).join(" ") + " L-2000 " + last.y + " L-2000 " + first.y + " Z";
  }).join(" "), [coast]);
  const graticule = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let lon = 30.85; lon <= 31.30; lon += 0.05) { const a = project(-29.99, lon); const b = project(-29.72, lon); lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y }); }
    for (let lat = -29.98; lat <= -29.73; lat += 0.05) { const a = project(lat, 30.82); const b = project(lat, 31.306); lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y }); }
    return lines;
  }, []);
  const statusLine = mapCoverageLine(isSample, track.length) + " · ZOOM " + zoom + "×";
  const identityLine = vesselIdentityLine(data.case);
  const hm = (iso: string) => iso.slice(11, 16) + "Z";
  const gridBasis = (basis: PositionBasis) =>
    basis.kind === "fix" ? "RECORDED " + hm(basis.at)
    : basis.kind === "stale" ? "LAST RECORDED " + hm(basis.at)
    : basis.kind === "before-first" ? "FIRST RECORDED " + hm(basis.at)
    : "DERIVED - NOT A RECORDING";
  const gapLine = gap ? "POSITION GAP " + hm(gap.from) + "-" + hm(gap.to) + " · NO RECORDED POSITIONS IN THIS WINDOW" : null;
  const basisLine = gapLine ?? (pos ? basisLabel(pos.basis) : null);
  const attributionLine = "COASTLINE © OPENSTREETMAP CONTRIBUTORS · TERMINAL AREAS APPROXIMATE";

  function onMapPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (zoom === 1) return;
    dragRef.current = { px: e.clientX, py: e.clientY, panX: pan.x, panY: pan.y };
  }
  function onMapPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const d = dragRef.current;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!d || !rect || rect.width === 0) return;
    const scale = vbObj.width / rect.width;
    setPan({ x: d.panX - (e.clientX - d.px) * scale, y: d.panY - (e.clientY - d.py) * scale });
  }
  function onMapPointerUp() { dragRef.current = null; }
  function resetView() { setZoom(1); setPan({ x: 0, y: 0 }); }

  const nearby = data.timeline.filter((e: any) => Math.abs(Date.parse(e.timestamp) - time) <= 24 * 3600000).slice(0, 10);
  const flagged = data.contradictions.filter((x: any) => x.status === "FLAGGED").slice(0, 6);
  const disputed = disputedClaimIds(data.contradictions);
  const dWindow = disputedWindow(data.claims, disputed);
  const inDisputedWindow = !!dWindow && time >= dWindow.start - 1 && time <= dWindow.end + 1;
  const inWindowAt = (t: number) => !!dWindow && t >= dWindow.start - 1 && t <= dWindow.end + 1;
  const markerColor = inDisputedWindow ? "var(--disputed)" : "#d2ff6b";

  const fmtTime = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + "Z";

  function guideVessel() {
    if (track.length) setTime(Date.parse(track[track.length - 1]!.at));
    setLayers((v) => ({ ...v, ais: true }));
    tapPreview({ kind: "vessel" });
  }
  function guideBerth() {
    setLayers((v) => ({ ...v, infrastructure: true }));
    tapPreview({ kind: "terminal", name: "Container terminal area", covers: "Approximate area - berths and container stacks on the Point" });
  }
  function guideDispute() {
    if (dWindow) setTime(dWindow.start);
    const flaggedScene = scenes.find((sc: any) => dWindow && Math.abs(Date.parse(String(sc.observed_at)) - dWindow.start) <= 48 * 3600000);
    if (flaggedScene) tapPreview({ kind: String(flaggedScene.observation_type).includes("SENTINEL_1") ? "sar" : "optical", scene: flaggedScene });
    else tapPreview({ kind: "vessel" });
  }

  async function captureMapPng(): Promise<Blob> {
    const svg = stageRef.current?.querySelector("svg");
    if (!svg) throw new Error("Map is not ready yet.");
    const clone = svg.cloneNode(true) as SVGSVGElement;
    // Evidence snapshots always capture the full map: reset any interactive zoom
    // so on-canvas identity and status labels are never cropped out of the pack.
    clone.setAttribute("viewBox", "0 0 1000 640");
    const disputeColor = getComputedStyle(document.documentElement).getPropertyValue("--disputed").trim() || "oklch(0.68 0.2 25)";
    const serialized = new XMLSerializer().serializeToString(clone).replaceAll("var(--disputed)", disputeColor);
    const withSize = serialized.replace("<svg ", '<svg width="2000" height="1280" font-family="JetBrains Mono, monospace" ');
    const url = URL.createObjectURL(new Blob([withSize], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Could not render the map image."));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = 2000; canvas.height = 1280;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not render the map image.");
      ctx.fillStyle = "#0a1b22";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // Fixed overlays live outside the zoomable svg; draw them onto the export
      // so identity, data status, position basis and attribution are always in the pack.
      ctx.fillStyle = "#d2ff6b";
      ctx.font = "20px 'JetBrains Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillText(statusLine, 36, 80);
      ctx.fillText(identityLine, 36, 116);
      if (basisLine) ctx.fillText(basisLine, 36, 152);
      ctx.textAlign = "right";
      ctx.fillText(attributionLine, 1964, 1244);
      return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => b ? resolve(b) : reject(new Error("Could not encode the map image.")), "image/png"));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function saveSnapshot() {
    setSaving(true); setSnapshotError(""); setSnapshotNotice("");
    try {
      const png = await captureMapPng();
      const last = track[track.length - 1];
      const at = new Date(time).toISOString();
      const path = data.tenantId + "/" + caseId + "/" + crypto.randomUUID() + "-map-snapshot.png";
      const { error: uploadError } = await supabase.storage.from("case-documents").upload(path, png, { upsert: false, contentType: "image/png" });
      if (uploadError) throw uploadError;
      const result = await addMapSnapshot({
        data: {
          caseId,
          filePath: path,
          name: "Harbour map snapshot - " + fmtTime(time),
          observedAt: at,
          summary: {
            vesselName: last?.vesselName || data.case.vessel_name || null,
            mmsi: last?.mmsi ?? null,
            lat: pos && locked ? pos.lat : null,
            lon: pos && locked ? pos.lon : null,
            sog: pos && locked ? Number(pos.sog.toFixed(1)) : null,
            cog: pos?.cog == null ? null : Math.round(pos.cog),
            inDisputedWindow,
            windowStart: dWindow ? new Date(dWindow.start).toISOString() : null,
            windowEnd: dWindow ? new Date(dWindow.end).toISOString() : null,
            note: isSample ? "Case contains sample data." : null,
          },
        },
      });
      setSnapshotNotice("Added to the evidence pack. Sealed with SHA-256 " + result.sha256.slice(0, 12) + "… — it will appear in the exported pack with its source and limits.");
      await router.invalidate();
    } catch (err) {
      setSnapshotError(err instanceof Error ? err.message : "Could not save the snapshot.");
    } finally {
      setSaving(false);
    }
  }

  function renderPreview() {
    if (!preview) return null;
    const last = track[track.length - 1];
    const fmt = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 16) + "Z";
    let title = "";
    let rows: [string, string][] = [];
    let dispute: { on: boolean; text: string } | null = null;
    if (preview.kind === "vessel") {
      title = "Case vessel";
      const name = last?.vesselName || data.case.vessel_name || "Unnamed vessel";
      rows = [
        ["Name", name + (data.case.voyage_no ? " · voyage " + data.case.voyage_no : "")],
        ["MMSI (radio ID)", last?.mmsi ?? "Not recorded"],
        ["Flag", "Not recorded"],
        ["Speed", pos ? pos.sog.toFixed(1) + " knots" : "No recorded positions"],
        ["Course", pos?.cog == null ? "Not recorded" : Math.round(pos.cog) + "°"],
        ["Destination", "Not recorded"],
        ["Last update", last ? fmt(Date.parse(last.at)) : "No positions recorded"],
        ["Position basis", pos ? basisDescription(pos.basis) : "None - no recorded positions"],
      ];
      dispute = { on: inDisputedWindow, text: inDisputedWindow ? "Inside the disputed window" + (dWindow ? " (" + fmt(dWindow.start) + " – " + fmt(dWindow.end) + ")" : "") : "Outside the disputed window" };
    } else if (preview.kind === "position") {
      title = "Recorded vessel position";
      const t = Date.parse(preview.p.at);
      rows = [
        ["Time", fmt(t)],
        ["Position", preview.p.lat.toFixed(5) + " / " + preview.p.lon.toFixed(5)],
        ["Speed", preview.p.sog.toFixed(1) + " knots"],
        ["Course", preview.p.cog == null ? "Not recorded" : Math.round(preview.p.cog) + "°"],
        ["Source", "AIS — the ship's own broadcast"],
      ];
      dispute = { on: inWindowAt(t), text: inWindowAt(t) ? "Inside the disputed window" : "Outside the disputed window" };
    } else if (preview.kind === "terminal") {
      title = preview.name;
      rows = [
        ["Location", "Durban harbour (approximate area overlay)"],
        ["Covers", preview.covers],
        ["Last refresh", "Fixed overlay — not live data"],
      ];
    } else if (preview.kind === "sar" || preview.kind === "optical") {
      const sc = preview.scene;
      const t = Date.parse(String(sc.observed_at));
      title = preview.kind === "sar" ? "Satellite radar image (Sentinel-1)" : "Satellite photo (Sentinel-2)";
      rows = [
        ["Captured", Number.isFinite(t) ? fmt(t) : "Not recorded"],
        ["What it shows", preview.kind === "sar" ? "Radar image of the boxed harbour area — sees through cloud" : "Photo of the boxed harbour area"],
        ["Orbit", String(sc.payload?.relativeOrbit ?? "Not recorded")],
      ];
      if (preview.kind === "optical") rows.push(["Cloud cover", Math.round(Number(sc.payload?.cloudPercent ?? 0)) + "%"]);
      rows.push(["Scene ID", String(sc.payload?.id ?? sc.id)]);
      if (Number.isFinite(t)) dispute = { on: inWindowAt(t), text: inWindowAt(t) ? "Captured inside the disputed window" : "Captured outside the disputed window" };
    } else if (preview.kind === "weather") {
      const t = Date.parse(String(preview.w.observed_at));
      title = "Sea state";
      rows = [
        ["Wave height", Number(preview.w.payload?.waveHeight ?? 0).toFixed(1) + " m"],
        ["Time", Number.isFinite(t) ? fmt(t) : "Not recorded"],
        ["Source", "Marine weather reading"],
      ];
    }
    return (
      <div className="relative z-10 mx-3 mt-3 rounded border border-[#d2ff6b]/40 bg-black/85 px-3 py-3 backdrop-blur md:absolute md:right-4 md:top-24 md:mx-0 md:mt-0 md:w-80" aria-live="polite">
        <div className="flex items-start justify-between gap-2">
          <div className="font-mono text-[10px] tracking-[0.2em] text-[#d2ff6b]">{title.toUpperCase()}</div>
          <button onClick={clearPreview} className="shrink-0 rounded border border-white/20 px-2 py-0.5 text-[10px] text-white/70 hover:text-white">Close</button>
        </div>
        <dl className="mt-2 space-y-1 font-sans text-xs text-white/90">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3"><dt className="shrink-0 text-white/60">{k}</dt><dd className="text-right">{v}</dd></div>
          ))}
        </dl>
        {dispute && (
          <div className="mt-2 flex items-center gap-2 border-t border-white/10 pt-2 text-xs">
            {dispute.on && <DisputeBadge />}
            <span className={dispute.on ? "font-medium" : "text-white/60"} style={dispute.on ? { color: "var(--disputed)" } : undefined}>{dispute.text}</span>
          </div>
        )}
      </div>
    );
  }

  async function refreshSensors() {
    setRefreshing(true);
    try {
      await corroborateCase({
        data: {
          caseId,
          start: new Date(initialTime).toISOString(),
          end: new Date(maxTime).toISOString(),
        },
      });
      await router.invalidate();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="rounded border bg-card px-3 py-2">
        <p className="text-sm">{track.length
          ? "Recorded vessel positions for this case plotted in place and time, so the disputed period can be checked against physical evidence. Only recorded data appears: positions derived between fixes are labelled as derived, stale positions are labelled with their last recorded time, and recording gaps stay visible as gaps."
          : "No vessel positions are recorded for this case yet. Playback still moves through the case events and satellite passes in time, and the vessel marker appears once AIS positions are stored - nothing on this map shows an invented location."}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">What to look at:</span>
          <button onClick={guideVessel} className="rounded border px-2.5 py-1 text-xs hover:bg-accent">The case vessel</button>
          <button onClick={guideBerth} className="rounded border px-2.5 py-1 text-xs hover:bg-accent">Berth & terminals</button>
          {dWindow && <button onClick={guideDispute} className="rounded border border-disputed/40 bg-disputed/10 px-2.5 py-1 text-xs text-disputed hover:bg-disputed/20">The disputed window ({new Date(dWindow.start).toISOString().slice(5, 10)} – {new Date(dWindow.end).toISOString().slice(5, 10)})</button>}
          <button onClick={() => setLarge(true)} className="ml-auto rounded border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary hover:bg-primary/20">Full screen</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {[
          ["DATA STATUS", inDisputedWindow ? "DISPUTED WINDOW" : isSample ? "SAMPLE DATA" : "RECORDED OBSERVATIONS · CORROBORATION"],
          ["TIME (UTC)", new Date(time).toISOString().replace("T", " ").slice(0, 19) + "Z"],
          ["VESSEL POSITION" + (pos && locked ? " · " + gridBasis(pos.basis) : ""), !pos ? (gap ? "GAP - NO RECORDED DATA" : "NO RECORDED POSITIONS") : !locked ? "FOLLOW OFF" : pos.lat.toFixed(5) + " / " + pos.lon.toFixed(5)],
          ["VESSEL COURSE" + (pos?.cog != null ? " · " + gridBasis(pos!.basis) : ""), pos?.cog == null ? "—" : Math.round(pos!.cog!) + "°"],
          ["MAP ZOOM", zoom + "×"],
        ].map(([label, value]) => (
          <div key={label} className={cn("min-w-0 rounded border bg-card px-3 py-2 font-mono", label === "DATA STATUS" && "col-span-2 md:col-span-1")}>
            <div className="text-[9px] tracking-[0.2em] text-muted-foreground">{label}</div>
            <div className="mt-1 truncate text-[11px] text-primary">{value}</div>
          </div>
        ))}
      </div>

      <Link
        to="/cases/$caseId/live-harbour"
        params={{ caseId: data.case.id }}
        className="flex items-center justify-between gap-3 rounded border border-primary/40 bg-primary/5 px-3 py-2 hover:bg-primary/10"
      >
        <span>
          <span className="font-mono text-[10px] tracking-[0.2em] text-primary">LIVE HARBOUR VIEW</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">Real-time vessels off the South African coast, inside this case.</span>
        </span>
        <span aria-hidden className="text-primary">→</span>
      </Link>

      <div ref={stageRef} className={large ? "fixed inset-0 z-50 overflow-y-auto bg-[#061016]" : "overflow-hidden rounded-lg border bg-[#061016]"}>
        {large && (
          <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[#d2ff6b]/20 bg-black/80 px-3 py-2 backdrop-blur">
            <span className="font-mono text-[10px] tracking-[0.2em] text-[#d2ff6b]">HARBOUR EVIDENCE MAP · FULL SCREEN</span>
            <button onClick={() => setLarge(false)} className="rounded border border-[#d2ff6b]/40 px-3 py-1 text-xs text-[#d2ff6b]">Close full screen</button>
          </div>
        )}
        <div className="relative">
          <svg
            ref={svgRef}
            viewBox={vb}
            className={large ? "block h-[calc(100vh-150px)] min-h-[320px] w-full" : "block h-auto aspect-[1000/640] md:aspect-auto w-full md:h-[calc(100vh-380px)] md:min-h-[340px]"}
            role="img"
            aria-label="CargoIQ harbour evidence map"
            style={{ cursor: zoom > 1 ? (dragRef.current ? "grabbing" : "grab") : "default", touchAction: "none" }}
            onPointerDown={onMapPointerDown}
            onPointerMove={onMapPointerMove}
            onPointerUp={onMapPointerUp}
            onPointerLeave={onMapPointerUp}
          >
            <defs>
              <filter id="hud-glow"><feGaussianBlur stdDeviation="2.5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            </defs>

            <rect width="1000" height="640" fill="#0a1b22" onClick={clearPreview} />

            {/* lat/lon graticule: real geographic reference, 0.05 degree spacing */}
            <g stroke="#d2ff6b" strokeOpacity="0.07">
              {graticule.map((l, i) => <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />)}
            </g>

            {/* real coastline (OpenStreetMap data) with land fill */}
            <path d={landPath} fill="#1c2a24" stroke="none" />
            {coast.map((chain, i) => (
              <polyline key={i} points={chain.map((pt) => pt.x + "," + pt.y).join(" ")} fill="none" stroke="#d2ff6b" strokeOpacity=".55" strokeWidth="1.5" />
            ))}

            {/* terminal areas: approximate, geo-anchored, always labelled approximate */}
            {layers.infrastructure && (
              <g fill="none" stroke="#d2ff6b" strokeDasharray="5 4" opacity=".78">
                {([
                  { name: "Container terminal area", covers: "Approximate area - berths and container stacks on the Point", lonMin: 31.02, lonMax: 31.06, latMin: -29.885, latMax: -29.855 },
                  { name: "Maydon Wharf area", covers: "Approximate area - south and west quays", lonMin: 30.995, lonMax: 31.03, latMin: -29.915, latMax: -29.885 },
                ]).map((t) => {
                  const a = project(t.latMax, t.lonMin);
                  const b = project(t.latMin, t.lonMax);
                  return (
                    <g key={t.name} style={{ cursor: "pointer" }} onClick={() => tapPreview({ kind: "terminal", name: t.name, covers: t.covers })} onMouseEnter={() => showPreview({ kind: "terminal", name: t.name, covers: t.covers })} onMouseLeave={hoverOut}>
                      <rect x={a.x} y={a.y} width={b.x - a.x} height={b.y - a.y} />
                      <text x={a.x + 5} y={a.y + 13} fill="#d2ff6b" stroke="none" fontSize="9" opacity=".85" pointerEvents="none">{t.name.toUpperCase()} (APPROX)</text>
                    </g>
                  );
                })}
                {(() => {
                  const c = project(-29.82, 31.14);
                  const r = scaleBarPx(3500);
                  const name = "Anchorage";
                  const covers = "Approximate waiting area for vessels outside the harbour entrance";
                  return (
                    <g style={{ cursor: "pointer" }} onClick={() => tapPreview({ kind: "terminal", name, covers })} onMouseEnter={() => showPreview({ kind: "terminal", name, covers })} onMouseLeave={hoverOut}>
                      <circle cx={c.x} cy={c.y} r={r} />
                      <text x={c.x - r + 5} y={c.y - r + 14} fill="#d2ff6b" stroke="none" fontSize="9" opacity=".85" pointerEvents="none">ANCHORAGE (APPROX)</text>
                    </g>
                  );
                })()}
              </g>
            )}

            {/* recorded vessel track: broken at unsupported gaps so no line implies a route across one */}
            {layers.ais && (
              <g filter="url(#hud-glow)">
                {segments.map((seg, si) => (
                  <polyline key={si} points={seg.map((pt) => { const c = project(pt.lat, pt.lon); return c.x + "," + c.y; }).join(" ")} fill="none" stroke="#d2ff6b" strokeWidth="2" opacity=".85" />
                ))}
                {track.map((pt, i) => {
                  const c = project(pt.lat, pt.lon);
                  return (
                    <g key={i} style={{ cursor: "pointer" }} onClick={() => tapPreview({ kind: "position", p: pt })} onMouseEnter={() => showPreview({ kind: "position", p: pt })} onMouseLeave={hoverOut}>
                      <circle cx={c.x} cy={c.y} r="14" fill="transparent" />
                      <circle cx={c.x} cy={c.y} r={Math.max(2, Math.min(6, 2 + pt.sog / 4))} fill="#d2ff6b" fillOpacity={Math.min(1, 0.2 + pt.sog / 12)} />
                    </g>
                  );
                })}
                {pos && (
                <g transform={"translate(" + pos.x + "," + pos.y + ")"} style={{ cursor: "pointer" }} onClick={() => tapPreview({ kind: "vessel" })} onMouseEnter={() => showPreview({ kind: "vessel" })} onMouseLeave={hoverOut}>
                  <circle r="30" fill="transparent" />
                  <circle r="18" fill="none" stroke={markerColor}>
                    <animate attributeName="r" values="12;28;12" dur="1.8s" repeatCount="indefinite" />
                  </circle>
                  <path d="M0 -10 L6 8 L0 4 L-6 8Z" fill={markerColor} />
                  <text x="16" y="-16" fill={markerColor} fontSize="11" fontFamily="JetBrains Mono" stroke="none">{(data.case.vessel_name || "Case vessel").toUpperCase()}</text>
                </g>
                )}
              </g>
            )}

            {pos && (
            <g stroke={markerColor} opacity=".82" pointerEvents="none">
              <path d={"M" + (pos.x - 30) + " " + pos.y + "H" + (pos.x + 30) + "M" + pos.x + " " + (pos.y - 30) + "V" + (pos.y + 30)} />
              <circle cx={pos.x} cy={pos.y} r="32" fill="none" />
              <circle cx={pos.x} cy={pos.y} r="45" fill="none" strokeDasharray="2 8" />
            </g>
            )}

            {!track.length && (
              <g pointerEvents="none">
                <rect x="270" y="262" width="460" height="116" fill="#000000" fillOpacity=".72" stroke="#d2ff6b" strokeOpacity=".45" rx="6" />
                <text x="500" y="296" textAnchor="middle" fill="#d2ff6b" fontFamily="JetBrains Mono" fontSize="13">{(data.case.vessel_name || "This vessel").toUpperCase()} - NO RECORDED POSITIONS</text>
                <text x="500" y="322" textAnchor="middle" fill="#ffffff" fillOpacity=".8" fontFamily="JetBrains Mono" fontSize="11">Vessel positions appear here once AIS broadcasts are</text>
                <text x="500" y="339" textAnchor="middle" fill="#ffffff" fillOpacity=".8" fontFamily="JetBrains Mono" fontSize="11">recorded for this case. Until then the map shows only:</text>
                <text x="500" y="356" textAnchor="middle" fill="#ffffff" fillOpacity=".8" fontFamily="JetBrains Mono" fontSize="11">{["real coastline", "approximate terminal areas", data.timeline.length ? "case events" : null].filter(Boolean).join(" · ")}</text>
              </g>
            )}

            {/* scale bar: real ground distance, zooms with the map */}
            <g pointerEvents="none">
              <line x1="30" y1="606" x2={30 + scaleBarPx(5000)} y2="606" stroke="#d2ff6b" strokeWidth="2" />
              <line x1="30" y1="600" x2="30" y2="612" stroke="#d2ff6b" strokeWidth="2" />
              <line x1={30 + scaleBarPx(5000)} y1="600" x2={30 + scaleBarPx(5000)} y2="612" stroke="#d2ff6b" strokeWidth="2" />
              <text x={34 + scaleBarPx(5000)} y="610" fill="#d2ff6b" fontSize="11" fontFamily="JetBrains Mono">5 KM</text>
            </g>
          </svg>

          {/* fixed overlays: readable at every zoom, drawn into evidence exports separately */}
          <div className="pointer-events-none absolute left-3 top-2 font-mono text-[10px] leading-relaxed text-[#d2ff6b]" style={{ textShadow: "0 1px 3px #000" }}>
            <div>{statusLine}</div>
            <div>{identityLine}</div>
            {basisLine && <div>{basisLine}</div>}
          </div>
          <div className="pointer-events-none absolute right-3 top-2 font-mono text-[10px] text-[#d2ff6b]" style={{ textShadow: "0 1px 3px #000" }}>N ↑</div>
          <div className="pointer-events-none absolute bottom-2 right-3 font-mono text-[9px] text-[#d2ff6b]/80" style={{ textShadow: "0 1px 3px #000" }}>{attributionLine}</div>
          {zoom > 1 && <div className="pointer-events-none absolute bottom-2 left-3 font-mono text-[9px] text-[#d2ff6b]/80" style={{ textShadow: "0 1px 3px #000" }}>DRAG TO PAN</div>}

          {renderPreview()}

          <div className="pointer-events-none hidden md:block absolute left-1/2 top-2 -translate-x-1/2 font-mono text-[10px] tracking-wider text-[#d2ff6b]/80">DURBAN HARBOUR · CASE EVIDENCE MAP</div>

          <div className="relative mx-3 mt-3 md:absolute md:mx-0 md:mt-0 md:left-4 md:top-14 rounded border border-[#d2ff6b]/40 bg-black/65 px-3 py-2 font-mono text-[10px] backdrop-blur">
            <div className="text-[#d2ff6b]">{!track.length ? "NO RECORDED POSITIONS" : !pos ? "NO RECORDED POSITION AT THIS TIME" : locked ? "FOLLOWING RECORDED POSITION" : "FOLLOW OFF"}</div>
            {pos && pos.basis.kind === "fix" && <div className="mt-1 text-white/70">RECORDED SPEED {pos.sog.toFixed(1)} kn · {hm(pos.basis.at)}</div>}
            {pos && pos.basis.kind === "stale" && <div className="mt-1 text-white/70">LAST RECORDED SPEED {pos.sog.toFixed(1)} kn · {hm(pos.basis.at)} - NO NEWER POSITIONS</div>}
            {pos && pos.basis.kind === "before-first" && <div className="mt-1 text-white/70">FIRST RECORDED SPEED {pos.sog.toFixed(1)} kn · {hm(pos.basis.at)} - NO EARLIER POSITIONS</div>}
            {pos && pos.basis.kind === "interpolated" && <div className="mt-1 text-white/70">SPEED DERIVED BETWEEN FIXES - APPROXIMATE</div>}
            {inDisputedWindow && <div className="mt-1 font-semibold" style={{ color: "var(--disputed)" }}>DISPUTED WINDOW</div>}
          </div>

          <div className="relative mx-3 mt-3 md:absolute md:mx-0 md:mt-0 md:left-4 md:top-[8.25rem] md:w-64 md:max-w-[45%] rounded border border-[#d2ff6b]/40 bg-black/70 px-3 py-2 font-mono text-[10px] backdrop-blur">
            <div className="flex items-center justify-between text-[#d2ff6b]"><span>EVENTS WITHIN 24H OF PLAYBACK</span><span className="text-white/60">{nearby.length}</span></div>
            <ul className="mt-2 max-h-44 space-y-2 overflow-y-auto pr-1 md:max-h-[clamp(64px,calc(100vh-640px),34vh)]">
              {nearby.map((e: any) => (
                <li key={e.id} className="border-t border-white/10 pt-1.5 first:border-t-0 first:pt-0">
                  <div className="flex items-center justify-between gap-2"><span className="text-white/60">{String(e.timestamp).slice(5, 16).replace("T", " ")}Z</span><span className="flex items-center gap-1.5">{isDisputeEvent(e, disputed) && <DisputeBadge />}{(String(e.nature).toLowerCase() !== "disputed" || !isDisputeEvent(e, disputed)) && <NatureBadge n={String(e.nature).toLowerCase() as any} />}</span></div>
                  <div className="mt-0.5 font-sans text-[11px] leading-snug text-white/90">{e.title}</div>
                </li>
              ))}
              {!nearby.length && <li className="font-sans text-[11px] text-white/60">No events near the selected time.</li>}
            </ul>
          </div>

          <div className="relative mx-3 my-3 md:absolute md:mx-0 md:my-0 md:inset-x-3 md:bottom-3 rounded border border-[#d2ff6b]/40 bg-black/75 px-3 py-2 backdrop-blur">
            <div className="flex flex-wrap items-center gap-2">
              {hasTemporalEvidence
                ? <Button className="py-1 text-xs" onClick={() => setPlaying((value) => !value)}>{playing ? "Pause" : "Play timeline"}</Button>
                : <span className="px-2 py-1 text-xs text-white/50">Play timeline - no recorded positions, satellite passes or case events yet</span>}
              {track.length > 0 && <Button variant="ghost" className="py-1 text-xs" disabled={!pos} title={pos ? "Centre the map on the recorded or derived position" : "No recorded position at this time to follow"} onClick={() => setLocked((value) => !value)}>{!pos ? "No position to follow" : locked ? "Following position" : "Follow recorded position"}</Button>}
              <Button variant="ghost" className="py-1 text-xs" disabled={refreshing} onClick={refreshSensors}>{refreshing ? "Refreshing…" : "Refresh satellite & marine data"}</Button>
              <Button variant="ghost" className="py-1 text-xs" disabled={saving} onClick={saveSnapshot}>{saving ? "Sealing…" : "Add to evidence pack"}</Button>
              <span className="ml-auto font-mono text-[10px] text-white/70">{new Date(time).toISOString().replace("T", " ").slice(0, 16)}Z</span>
            </div>
            <input type="range" min={initialTime} max={maxTime} step={15 * 60 * 1000} value={time} onChange={(e) => setTime(Number(e.target.value))} className="mt-1 w-full accent-[#d2ff6b]" aria-label="Investigation timeline" />
            <div className="flex justify-between font-mono text-[9px] text-white/50"><span>{new Date(initialTime).toISOString().slice(0, 16)}Z</span><span>{new Date(maxTime).toISOString().slice(0, 16)}Z</span></div>
          </div>

          <div className="relative mx-3 mb-3 flex flex-wrap gap-1 md:absolute md:mx-0 md:mb-0 md:right-4 md:top-8 md:max-w-[60%] md:justify-end">
            <button aria-label="Zoom in" onClick={() => setZoom((z) => clampZoom(z * 1.5))} className="rounded border border-[#d2ff6b]/35 bg-black/65 px-2 py-1 font-mono text-[10px] uppercase text-[#d2ff6b]">+ Zoom in</button>
            <button aria-label="Zoom out" onClick={() => setZoom((z) => clampZoom(z / 1.5))} className="rounded border border-[#d2ff6b]/35 bg-black/65 px-2 py-1 font-mono text-[10px] uppercase text-[#d2ff6b]">- Zoom out</button>
            {zoom !== 1 && <button aria-label="Reset zoom" onClick={resetView} className="rounded border border-[#d2ff6b]/35 bg-black/65 px-2 py-1 font-mono text-[10px] uppercase text-[#d2ff6b]">Reset view</button>}
            {Object.entries(layers).map(([key, enabled]) => (
              <button
                key={key}
                onClick={() => setLayers((value) => ({ ...value, [key]: !enabled }))}
                className={cn("rounded border border-[#d2ff6b]/35 bg-black/65 px-2 py-1 font-mono text-[10px] uppercase text-[#d2ff6b]", !enabled && "opacity-30")}
              >
                {({ ais: "Vessel track", infrastructure: "Terminal areas" } as Record<string, string>)[key] ?? key}
              </button>
            ))}
          </div>
        </div>
      </div>


      {snapshotNotice && <div className="rounded border border-observed/40 bg-observed/10 px-3 py-2 text-sm text-observed">{snapshotNotice}</div>}
      {snapshotError && <div className="rounded border border-disputed/40 bg-disputed/10 px-3 py-2 text-sm text-disputed">{snapshotError}</div>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Satellite coverage">
          <ul className="space-y-3">
            {scenes.slice(0, 8).map((s: any) => (
              <li key={s.id} className="rounded border p-3">
                <div className="flex justify-between font-mono text-[10px] text-observed"><span>{s.observation_type}</span><span>{s.observed_at ? new Date(s.observed_at).toISOString() : "—"}</span></div>
                <div className="mt-1 text-xs text-muted-foreground">{s.payload?.id ?? s.id} · orbit {s.payload?.relativeOrbit ?? "—"} · cloud {s.payload?.cloudPercent ?? "n/a"}</div>
              </li>
            ))}
            {!scenes.length && <li className="text-sm text-muted-foreground">No Sentinel observations stored yet. Refresh data to query Copernicus satellites.</li>}
          </ul>
        </Panel>

        <Panel title="Discrepancy callouts">
          {flagged.map((c: any) => (
            <div key={c.id} className="mb-3 rounded border border-disputed/40 bg-disputed/5 p-3 text-sm">
              <div className="flex items-center gap-2"><DisputeBadge /><span className="font-medium text-disputed">{c.title}</span></div>
              <div className="mt-1 text-xs text-muted-foreground">{c.description}</div>
            </div>
          ))}
          {!flagged.length && <p className="text-sm text-muted-foreground">No unresolved discrepancies at the current case state.</p>}
        </Panel>
      </div>
    </div>
  );
}

