import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ClassTag, NatureBadge, Panel, natureFill } from "@/components/ui-kit";
import { TIMELINE, fmtDT, NATURE_LABEL, type Nature } from "@/lib/case-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/cases/$caseId/")({
  head: () => ({ meta: [{ title: "Investigation timeline | CargoIQ" }, { name: "description", content: "Reconstructed event timeline with provenance." }] }),
  component: TimelinePage,
});

function TimelinePage() {
  const [active, setActive] = useState<Set<Nature>>(new Set(Object.keys(NATURE_LABEL) as Nature[]));
  const [sel, setSel] = useState(TIMELINE[1]!.id);
  const events = TIMELINE.filter((e) => active.has(e.nature));
  const t0 = new Date(TIMELINE[0]!.at).getTime();
  const t1 = new Date(TIMELINE[TIMELINE.length - 1]!.at).getTime();
  const pos = (s: string) => ((new Date(s).getTime() - t0) / (t1 - t0)) * 100;
  const selected = TIMELINE.find((e) => e.id === sel)!;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(NATURE_LABEL) as Nature[]).map((n) => (
          <button key={n} onClick={() => { const s = new Set(active); s.has(n) ? s.delete(n) : s.add(n); setActive(s); }}
            className={cn("rounded-full border px-3 py-1 text-xs transition-opacity", !active.has(n) && "opacity-35")}>
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: natureFill[n] }} />{NATURE_LABEL[n]}
          </button>
        ))}
      </div>

      <Panel title="Temporal reconstruction · 03 – 20 Aug 2026">
        <div className="relative h-36">
          <div className="absolute left-0 right-0 top-1/2 h-px bg-border" />
          <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-disputed/30" style={{ left: `${pos("2026-08-04T08:00")}%`, width: `${pos("2026-08-05T06:12") - pos("2026-08-04T08:00")}%` }} title="Availability gap" />
          <div className="absolute top-1/2 h-1 -translate-y-1/2 rounded bg-disputed/30" style={{ left: `${pos("2026-08-15T10:05")}%`, width: `${pos("2026-08-19T00:00") - pos("2026-08-15T10:05")}%` }} title="Release gap" />
          {events.map((e, i) => (
            <button key={e.id} onClick={() => setSel(e.id)} className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${pos(e.at)}%` }}>
              <span className={cn("block h-3.5 w-3.5 rotate-45 border-2 transition-transform group-hover:scale-125", e.id === sel && "scale-150")}
                style={{ borderColor: natureFill[e.nature], background: e.nature === "inferred" ? "transparent" : natureFill[e.nature] }} />
              <span className={cn("absolute left-1/2 w-28 -translate-x-1/2 text-center font-mono text-[10px] text-muted-foreground", i % 2 ? "top-6" : "bottom-6")}>{fmtDT(e.at)}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground"><span className="mr-1 inline-block h-1 w-4 rounded bg-disputed/40 align-middle" />Shaded bands mark periods where sources disagree.</p>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Panel title="Event ledger">
          <ol className="divide-y">
            {events.map((e) => (
              <li key={e.id}>
                <button onClick={() => setSel(e.id)} className={cn("grid w-full grid-cols-[120px_1fr_auto] items-center gap-4 px-2 py-3 text-left text-sm hover:bg-accent", e.id === sel && "bg-accent")}>
                  <span className="font-mono text-xs text-muted-foreground">{fmtDT(e.at)}</span>
                  <span>{e.label}<span className="block text-xs text-muted-foreground">{e.source}</span></span>
                  <NatureBadge n={e.nature} />
                </button>
              </li>
            ))}
          </ol>
        </Panel>
        <Panel title="Provenance">
          <div className="space-y-4 text-sm">
            <NatureBadge n={selected.nature} />
            <p className="text-base font-medium">{selected.label}</p>
            <dl className="grid grid-cols-[90px_1fr] gap-y-2 text-xs">
              <dt className="text-muted-foreground">Timestamp</dt><dd className="font-mono">{selected.at} UTC</dd>
              <dt className="text-muted-foreground">Source</dt><dd>{selected.source}</dd>
              <dt className="text-muted-foreground">Class</dt><dd><ClassTag c={selected.cls} /></dd>
              <dt className="text-muted-foreground">Reference</dt><dd className="font-mono">{selected.ref ?? "—"}</dd>
            </dl>
          </div>
        </Panel>
      </div>
    </div>
  );
}
