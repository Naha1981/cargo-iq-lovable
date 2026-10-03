import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Panel, NatureBadge } from "@/components/ui-kit";
import { AIS_TRACK, SATELLITE, TIMELINE, fmtDT } from "@/lib/case-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/cases/$caseId/map")({
  head: () => ({ meta: [{ title: "God's Eye View — Durban Harbour | CargoIQ" }, { name: "description", content: "AIS, satellite and terminal evidence aligned on the harbour map." }] }),
  component: MapPage,
});

const T0 = new Date(AIS_TRACK[0]!.at).getTime();
const T1 = new Date("2026-08-19T00:00").getTime();

function vesselAt(t: number) {
  let prev = AIS_TRACK[0]!;
  for (const p of AIS_TRACK) {
    const pt = new Date(p.at).getTime();
    if (pt >= t) {
      const a = new Date(prev.at).getTime();
      const f = pt === a ? 1 : (t - a) / (pt - a);
      return { x: prev.x + (p.x - prev.x) * f, y: prev.y + (p.y - prev.y) * f, sog: p.sog };
    }
    prev = p;
  }
  return prev;
}

function MapPage() {
  const [t, setT] = useState(new Date("2026-08-05T06:12").getTime());
  const [layers, setLayers] = useState({ ais: true, sat: true, infra: true });
  const v = vesselAt(t);
  const berthed = t >= new Date("2026-08-05T06:12").getTime();
  const nearby = TIMELINE.filter((e) => Math.abs(new Date(e.at).getTime() - t) < 36 * 3600000);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <div className="relative overflow-hidden rounded-lg border bg-water">
          <svg viewBox="0 0 1000 640" className="block w-full">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M40 0H0V40" fill="none" stroke="var(--foreground)" strokeOpacity="0.05" />
              </pattern>
            </defs>
            <rect width="1000" height="640" fill="url(#grid)" />
            {/* land masses */}
            <path d="M0 0H1000V180C880 200 780 150 700 190C600 240 520 200 420 230C320 260 200 210 0 260Z" fill="var(--land)" />
            <path d="M0 640V420C120 400 220 450 300 430C360 415 380 470 340 520C300 580 160 600 0 640Z" fill="var(--land)" />
            <path d="M560 640C600 560 700 520 820 600C870 630 900 640 900 640Z" fill="var(--land)" />
            {layers.infra && (
              <g fontFamily="JetBrains Mono" fontSize="11" fill="var(--muted-foreground)">
                <rect x="330" y="232" width="200" height="54" fill="none" stroke="var(--primary)" strokeDasharray="5 4" />
                <text x="334" y="226">PIER 2 · CONTAINER TERMINAL</text>
                {[0, 1, 2, 3].map((i) => (
                  <g key={i}><rect x={340 + i * 46} y="286" width="40" height="20" fill="var(--secondary)" stroke="var(--border)" />
                    <text x={344 + i * 46} y="300" fontSize="9" fill={i === 2 ? "var(--primary)" : "var(--muted-foreground)"}>B20{i + 1}</text></g>
                ))}
                <rect x="120" y="270" width="150" height="40" fill="none" stroke="var(--border)" strokeDasharray="4 4" />
                <text x="124" y="264">MAYDON WHARF</text>
                <circle cx="900" cy="515" r="60" fill="none" stroke="var(--reported)" strokeOpacity="0.5" strokeDasharray="3 5" />
                <text x="842" y="445">OUTER ANCHORAGE</text>
                <text x="760" y="630">HARBOUR ENTRANCE →</text>
              </g>
            )}
            {layers.sat && SATELLITE.map((s, i) => (
              <g key={s.id}>
                <rect x={i ? 380 : 830} y={i ? 250 : 450} width={i ? 120 : 140} height={i ? 90 : 130} fill="var(--observed)" fillOpacity="0.06" stroke="var(--observed)" strokeOpacity="0.6" />
                <text x={i ? 384 : 834} y={i ? 336 : 576} fontFamily="JetBrains Mono" fontSize="9" fill="var(--observed)">{s.sensor.toUpperCase()}</text>
              </g>
            ))}
            {layers.ais && (
              <>
                <polyline points={AIS_TRACK.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="var(--observed)" strokeWidth="2" strokeDasharray="2 6" strokeLinecap="round" />
                {AIS_TRACK.map((p) => <circle key={p.at} cx={p.x} cy={p.y} r="3" fill="var(--observed)" />)}
                <g transform={`translate(${v.x},${v.y})`}>
                  <circle r="18" fill="var(--primary)" fillOpacity="0.15"><animate attributeName="r" values="12;24;12" dur="2.4s" repeatCount="indefinite" /></circle>
                  <path d="M0 -10 L6 8 L0 4 L-6 8Z" fill="var(--primary)" />
                </g>
              </>
            )}
          </svg>
          <div className="absolute left-3 top-3 rounded-md border bg-background/85 px-3 py-2 font-mono text-xs backdrop-blur">
            <div className="text-primary">MSC AURORA · MMSI 636092114</div>
            <div className="text-muted-foreground">{fmtDT(new Date(t).toISOString())} UTC · SOG {v.sog.toFixed(1)} kn</div>
            <div className={berthed ? "text-observed" : "text-disputed"}>{berthed ? "Alongside Berth 203" : "Not berthed — cargo cannot be available"}</div>
          </div>
          <div className="absolute right-3 top-3 flex gap-1">
            {(Object.keys(layers) as (keyof typeof layers)[]).map((k) => (
              <button key={k} onClick={() => setLayers({ ...layers, [k]: !layers[k] })}
                className={cn("rounded border bg-background/85 px-2 py-1 font-mono text-[10px] uppercase backdrop-blur", !layers[k] && "opacity-40")}>{k}</button>
            ))}
          </div>
        </div>
        <Panel>
          <input type="range" min={T0} max={T1} step={1800000} value={t} onChange={(e) => setT(Number(e.target.value))} className="w-full accent-[var(--primary)]" aria-label="Time scrubber" />
          <div className="relative mt-1 h-5">
            {TIMELINE.filter((e) => new Date(e.at).getTime() <= T1).map((e) => (
              <button key={e.id} title={e.label} onClick={() => setT(new Date(e.at).getTime())}
                className="absolute h-3 w-1 -translate-x-1/2 rounded-sm" style={{ left: `${((new Date(e.at).getTime() - T0) / (T1 - T0)) * 100}%`, background: `var(--${e.nature})` }} />
            ))}
          </div>
          <div className="flex justify-between font-mono text-[10px] text-muted-foreground"><span>03 Aug</span><span>Drag to replay · click a tick to jump</span><span>19 Aug</span></div>
        </Panel>
      </div>

      <div className="space-y-6">
        <Panel title="Events within ±36h">
          {nearby.length ? (
            <ul className="space-y-3">{nearby.map((e) => (
              <li key={e.id} className="text-sm"><div className="flex items-center justify-between"><span className="font-mono text-xs text-muted-foreground">{fmtDT(e.at)}</span><NatureBadge n={e.nature} /></div>{e.label}</li>
            ))}</ul>
          ) : <p className="text-sm text-muted-foreground">No case events near this time.</p>}
        </Panel>
        <Panel title="Satellite scenes">
          <ul className="space-y-3">{SATELLITE.map((s) => (
            <li key={s.id}>
              <button onClick={() => setT(new Date(s.at).getTime())} className="w-full rounded-md border bg-panel p-3 text-left hover:bg-accent">
                <div className="flex justify-between font-mono text-[10px] text-observed"><span>{s.sensor}</span><span>cloud {s.cloud}</span></div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">{s.id}</div>
                <div className="mt-1 text-sm">{s.finding}</div>
              </button>
            </li>
          ))}</ul>
        </Panel>
      </div>
    </div>
  );
}
