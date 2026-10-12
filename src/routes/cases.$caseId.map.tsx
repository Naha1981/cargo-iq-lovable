import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button, NatureBadge, Panel } from "@/components/ui-kit";
import { corroborateCase, getCaseWorkspace } from "@/lib/case.functions";
import { cn } from "@/lib/utils";

type TrackPoint = { at: string; lat: number; lon: number; sog: number; cog: number | null };

const DURBAN = { lat: -29.8833, lon: 31.05 };

function project(lat: number, lon: number) {
  const x = Math.max(20, Math.min(980, 500 + (lon - DURBAN.lon) * 1600));
  const y = Math.max(20, Math.min(620, 320 - (lat - DURBAN.lat) * 1600));
  return { x, y };
}

function aisTrack(observations: any[]): TrackPoint[] {
  return observations
    .filter((x) => x.observation_type === "AIS_POSITION" && x.latitude != null && x.longitude != null)
    .map((x) => ({
      at: String(x.observed_at),
      lat: Number(x.latitude),
      lon: Number(x.longitude),
      sog: Number(x.payload?.sog ?? 0),
      cog: x.payload?.cog == null ? null : Number(x.payload.cog),
    }))
    .filter((x) => Number.isFinite(Date.parse(x.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export const Route = createFileRoute("/cases/$caseId/map")({
  loader: ({ params }) => getCaseWorkspace({ data: { caseId: params.caseId } }),
  head: () => ({ meta: [{ title: "God's Eye View — Tactical Investigation | CargoIQ" }] }),
  component: MapPage,
});

function MapPage() {
  const { caseId } = Route.useParams();
  const data = Route.useLoaderData();
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

  const initialTime = times.length ? Math.min(...times) : Date.now();
  const maxTime = times.length ? Math.max(...times, initialTime + 3600000) : initialTime + 24 * 3600000;

  const [time, setTime] = useState(initialTime);
  const [playing, setPlaying] = useState(false);
  const [locked, setLocked] = useState(true);
  const [layers, setLayers] = useState({ ais: true, sar: true, optical: true, weather: false, infrastructure: true });
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setTime((value) => value >= maxTime ? initialTime : value + 15 * 60 * 1000);
    }, 120);
    return () => window.clearInterval(id);
  }, [playing, initialTime, maxTime]);

  const current = useMemo(() => {
    if (!track.length) return { x: 500, y: 320, sog: 0, lat: DURBAN.lat, lon: DURBAN.lon, cog: null };
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
    return { ...project(lat, lon), lat, lon, sog: a.sog + (b.sog - a.sog) * f, cog: a.cog ?? b.cog };
  }, [track, time]);

  const nearby = data.timeline.filter((e: any) => Math.abs(Date.parse(e.timestamp) - time) <= 24 * 3600000).slice(0, 10);
  const flagged = data.contradictions.filter((x: any) => x.status === "FLAGGED").slice(0, 6);

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
      <div className="grid gap-2 md:grid-cols-5">
        {[
          ["CLASSIFICATION", isSample ? "SAMPLE DATA" : "RECORDED OBSERVATIONS // CORROBORATION"],
          ["UTC MASTER", new Date(time).toISOString().replace("T", " ").slice(0, 19) + "Z"],
          ["TARGET LOCK", locked ? current.lat.toFixed(5) + " / " + current.lon.toFixed(5) : "OFF"],
          ["AZIMUTH", current.cog == null ? "—" : Math.round(current.cog) + "°"],
          ["FOV", "42° · RANGE 35 KM"],
        ].map(([label, value]) => (
          <div key={label} className="rounded border bg-card px-3 py-2 font-mono">
            <div className="text-[9px] tracking-[0.2em] text-muted-foreground">{label}</div>
            <div className="mt-1 truncate text-[11px] text-primary">{value}</div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border bg-[#061016]">
        <div className="relative">
          <svg viewBox="0 0 1000 640" className="block h-[560px] w-full" role="img" aria-label="CargoIQ tactical harbour investigation map">
            <defs>
              <pattern id="hud-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M40 0H0V40" fill="none" stroke="#d2ff6b" strokeOpacity="0.09" />
              </pattern>
              <radialGradient id="hud-vignette">
                <stop offset="55%" stopColor="transparent" />
                <stop offset="100%" stopColor="#000000" stopOpacity="0.82" />
              </radialGradient>
              <filter id="hud-glow"><feGaussianBlur stdDeviation="2.5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            </defs>

            <rect width="1000" height="640" fill="#08151a" />
            <rect width="1000" height="640" fill="url(#hud-grid)" />

            <path d="M0 0H1000V175C860 200 760 145 690 190C560 235 450 215 320 235C200 255 110 230 0 260Z" fill="#1f2a26" />
            <path d="M0 640V415C150 390 235 455 310 425C360 410 380 475 325 530C265 595 150 615 0 640Z" fill="#1f2a26" />

            {layers.infrastructure && (
              <g fill="none" stroke="#d2ff6b" strokeDasharray="5 4" opacity=".78">
                <rect x="330" y="225" width="210" height="70" />
                <rect x="345" y="302" width="190" height="92" />
                <circle cx="900" cy="515" r="64" />
              </g>
            )}

            {layers.ais && (
              <g filter="url(#hud-glow)">
                <polyline
                  points={track.map((p) => {
                    const pos = project(p.lat, p.lon);
                    return pos.x + "," + pos.y;
                  }).join(" ")}
                  fill="none"
                  stroke="#d2ff6b"
                  strokeWidth="2"
                  opacity=".85"
                />
                {track.map((p, i) => {
                  const pos = project(p.lat, p.lon);
                  return <circle key={i} cx={pos.x} cy={pos.y} r={Math.max(2, Math.min(6, 2 + p.sog / 4))} fill="#d2ff6b" fillOpacity={Math.min(1, 0.2 + p.sog / 12)} />;
                })}
                <g transform={"translate(" + current.x + "," + current.y + ")"}>
                  <circle r="18" fill="none" stroke="#d2ff6b">
                    <animate attributeName="r" values="12;28;12" dur="1.8s" repeatCount="indefinite" />
                  </circle>
                  <path d="M0 -10 L6 8 L0 4 L-6 8Z" fill="#d2ff6b" />
                </g>
              </g>
            )}

            {layers.sar && scenes.filter((s: any) => s.observation_type === "SENTINEL_1_SCENE").map((scene: any, i: number) => (
              <g key={scene.id}>
                <rect x={680 + i * 50} y={70 + i * 45} width="165" height="110" fill="#5ffbf1" fillOpacity=".04" stroke="#5ffbf1" strokeOpacity=".75" />
                <text x={687 + i * 50} y={88 + i * 45} fill="#5ffbf1" fontSize="10">S1 SAR · ORBIT {scene.payload?.relativeOrbit ?? "—"}</text>
              </g>
            ))}

            {layers.optical && scenes.filter((s: any) => s.observation_type === "SENTINEL_2_SCENE").map((scene: any, i: number) => (
              <g key={scene.id}>
                <rect x={80 + i * 55} y={395 + i * 35} width="165" height="90" fill="#7dd3fc" fillOpacity=".04" stroke="#7dd3fc" strokeOpacity=".72" />
                <text x={87 + i * 55} y={413 + i * 35} fill="#7dd3fc" fontSize="10">S2 MSI · CLOUD {Math.round(Number(scene.payload?.cloudPercent ?? 0))}%</text>
              </g>
            ))}

            {layers.weather && marine.slice(-8).map((w: any, i: number) => (
              <circle key={i} cx={760 + i * 22} cy={565} r={Math.max(4, Number(w.payload?.waveHeight ?? 1) * 3)} fill="#7dd3fc" fillOpacity=".26" />
            ))}

            <g stroke="#d2ff6b" opacity=".82">
              <path d={"M" + (current.x - 30) + " " + current.y + "H" + (current.x + 30) + "M" + current.x + " " + (current.y - 30) + "V" + (current.y + 30)} />
              <circle cx={current.x} cy={current.y} r="32" fill="none" />
              <circle cx={current.x} cy={current.y} r="45" fill="none" strokeDasharray="2 8" />
            </g>

            <rect x="3" y="3" width="994" height="634" fill="url(#hud-vignette)" />
            <g fill="#d2ff6b" fontFamily="JetBrains Mono" fontSize="10">
              <text x="18" y="22">DURBAN HARBOUR · CASE-SCOPED RECON</text>
              <text x="18" y="625">FOV 42° · RANGE 35 KM · {isSample ? "SAMPLE DATA" : track.length ? "RECORDED OBSERVATIONS" : "AWAITING SENSOR REFRESH"}</text>
              <text x="930" y="625">N ↑</text>
            </g>
          </svg>

          <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:repeating-linear-gradient(to_bottom,transparent_0,transparent_2px,#d2ff6b_2px,#d2ff6b_3px)]" />

          <div className="absolute left-4 top-4 rounded border border-[#d2ff6b]/40 bg-black/65 px-3 py-2 font-mono text-[10px] backdrop-blur">
            <div className="text-[#d2ff6b]">TARGET {locked ? "LOCKED" : "UNLOCKED"}</div>
            <div className="mt-1 text-white/70">SOG {current.sog.toFixed(1)} kn</div>
          </div>

          <div className="absolute right-4 top-4 flex max-w-[70%] flex-wrap justify-end gap-1">
            {Object.entries(layers).map(([key, enabled]) => (
              <button
                key={key}
                onClick={() => setLayers((value) => ({ ...value, [key]: !enabled }))}
                className={cn("rounded border border-[#d2ff6b]/35 bg-black/65 px-2 py-1 font-mono text-[9px] uppercase text-[#d2ff6b]", !enabled && "opacity-30")}
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      </div>

      <Panel
        title="Temporal / sensor control"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" className="py-1 text-xs" onClick={() => setLocked((value) => !value)}>{locked ? "Target locked" : "Target unlocked"}</Button>
            <Button className="py-1 text-xs" onClick={() => setPlaying((value) => !value)}>{playing ? "Pause" : "Play timeline"}</Button>
            <Button variant="ghost" className="py-1 text-xs" disabled={refreshing} onClick={refreshSensors}>{refreshing ? "Refreshing…" : "Refresh sensors"}</Button>
          </div>
        }
      >
        <input type="range" min={initialTime} max={maxTime} step={15 * 60 * 1000} value={time} onChange={(e) => setTime(Number(e.target.value))} className="w-full accent-[#d2ff6b]" aria-label="Investigation timeline" />
        <div className="mt-2 flex justify-between gap-4 font-mono text-[10px] text-muted-foreground">
          <span>{new Date(initialTime).toISOString()}</span>
          <span>Temporal cursor · observations remain source-attributed</span>
          <span>{new Date(maxTime).toISOString()}</span>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Events at cursor">
          <ul className="space-y-3">
            {nearby.map((e: any) => (
              <li key={e.id} className="text-sm">
                <div className="flex items-center justify-between"><span className="font-mono text-[10px] text-muted-foreground">{e.timestamp}</span><NatureBadge n={String(e.nature).toLowerCase() as any} /></div>
                <div className="mt-1">{e.title}</div>
                <div className="text-xs text-muted-foreground">{e.source}</div>
              </li>
            ))}
            {!nearby.length && <li className="text-sm text-muted-foreground">No events near the temporal cursor.</li>}
          </ul>
        </Panel>

        <Panel title="Satellite footprints">
          <ul className="space-y-3">
            {scenes.slice(0, 8).map((s: any) => (
              <li key={s.id} className="rounded border p-3">
                <div className="flex justify-between font-mono text-[10px] text-observed"><span>{s.observation_type}</span><span>{s.observed_at ? new Date(s.observed_at).toISOString() : "—"}</span></div>
                <div className="mt-1 text-xs text-muted-foreground">{s.payload?.id ?? s.id} · orbit {s.payload?.relativeOrbit ?? "—"} · cloud {s.payload?.cloudPercent ?? "n/a"}</div>
              </li>
            ))}
            {!scenes.length && <li className="text-sm text-muted-foreground">No Sentinel observations stored yet. Refresh sensors to query Copernicus.</li>}
          </ul>
        </Panel>

        <Panel title="Discrepancy callouts">
          {flagged.map((c: any) => (
            <div key={c.id} className="mb-3 rounded border border-disputed/40 bg-disputed/5 p-3 text-sm">
              <div className="font-medium text-disputed">{c.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">{c.description}</div>
            </div>
          ))}
          {!flagged.length && <p className="text-sm text-muted-foreground">No unresolved discrepancies at the current case state.</p>}
        </Panel>
      </div>
    </div>
  );
}

