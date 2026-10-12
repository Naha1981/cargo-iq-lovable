import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getCaseWorkspace } from "@/lib/case.functions";
import { Panel, NatureBadge, ClassTag } from "@/components/ui-kit";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/cases/$caseId/")({
  loader: ({ params }) => getCaseWorkspace({ data: { caseId: params.caseId } }),
  head: () => ({ meta: [{ title: "Investigation timeline | CargoIQ" }] }),
  component: TimelinePage,
});

function TimelinePage() {
  const data = Route.useLoaderData();
  const [events, setEvents] = useState(data.timeline);
  const [selectedId, setSelectedId] = useState(data.timeline[0]?.id ?? "");

  useEffect(() => {
    setEvents(data.timeline);
    if (!selectedId && data.timeline[0]) setSelectedId(data.timeline[0].id);
  }, [data.timeline, selectedId]);

  const selected = events.find((e: any) => e.id === selectedId) ?? events[0];
  const t0 = events.length ? Date.parse(events[0].timestamp) : Date.now();
  const t1 = events.length ? Date.parse(events[events.length - 1].timestamp) : t0 + 1;
  const pos = (s: string) => t1 === t0 ? 50 : ((Date.parse(s) - t0) / (t1 - t0)) * 100;

  return (
    <div className="space-y-6">
      <Panel title={"Temporal reconstruction · " + (events.length ? new Date(t0).toISOString().slice(0,10) + " – " + new Date(t1).toISOString().slice(0,10) : "No events")}>
        {!events.length ? (
          <div className="py-14 text-center text-sm text-muted-foreground">No timeline events yet. Upload records or refresh external sensors.</div>
        ) : (
          <div className="relative h-40">
            <div className="absolute left-0 right-0 top-1/2 h-px bg-border" />
            {events.map((e: any, i: number) => (
              <button
                key={e.id}
                onClick={() => setSelectedId(e.id)}
                className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ left: pos(e.timestamp) + "%" }}
              >
                <span className={cn(
                  "block h-3.5 w-3.5 rotate-45 border-2 transition-transform group-hover:scale-125",
                  e.id === selected?.id && "scale-150",
                )} style={{ borderColor: "var(--" + String(e.nature).toLowerCase() + ")", background: e.nature === "INFERRED" ? "transparent" : "var(--" + String(e.nature).toLowerCase() + ")" }} />
                <span className={"absolute left-1/2 w-28 -translate-x-1/2 text-center font-mono text-[10px] text-muted-foreground " + (i % 2 ? "top-6" : "bottom-6")}>
                  {new Date(e.timestamp).toISOString().slice(0,16).replace("T"," ")}Z
                </span>
              </button>
            ))}
          </div>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Panel title={"Event ledger · " + events.length}>
          <ol className="divide-y">
            {events.map((e: any) => (
              <li key={e.id}>
                <button
                  onClick={() => setSelectedId(e.id)}
                  className={cn("grid w-full grid-cols-[150px_1fr_auto] items-center gap-4 px-2 py-3 text-left text-sm hover:bg-accent", e.id === selected?.id && "bg-accent")}
                >
                  <span className="font-mono text-xs text-muted-foreground">{new Date(e.timestamp).toISOString().slice(0,16).replace("T"," ")}Z</span>
                  <span>{e.title}<span className="block text-xs text-muted-foreground">{e.source}</span></span>
                  <NatureBadge n={String(e.nature).toLowerCase() as any} />
                </button>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Provenance">
          {selected ? (
            <div className="space-y-4 text-sm">
              <NatureBadge n={String(selected.nature).toLowerCase() as any} />
              <p className="text-base font-medium">{selected.title}</p>
              <dl className="grid grid-cols-[95px_1fr] gap-y-2 text-xs">
                <dt className="text-muted-foreground">Timestamp</dt><dd className="font-mono">{selected.timestamp} UTC</dd>
                <dt className="text-muted-foreground">Source</dt><dd>{selected.source}</dd>
                <dt className="text-muted-foreground">Class</dt><dd><ClassTag c={selected.evidence_class} /></dd>
                <dt className="text-muted-foreground">Coordinates</dt><dd className="font-mono">{selected.coordinates ? JSON.stringify(selected.coordinates) : "—"}</dd>
              </dl>
            </div>
          ) : <p className="text-sm text-muted-foreground">Select an event.</p>}
        </Panel>
      </div>
    </div>
  );
}
