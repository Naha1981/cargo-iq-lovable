import { Route as CaseRoute } from "./cases.$caseId";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Panel, Stat, NatureBadge, ClassTag, DisputeBadge } from "@/components/ui-kit";
import { cn } from "@/lib/utils";
import { disputedClaimIds, disputedWindow, isDisputeEvent } from "@/lib/dispute";
import { type Nature } from "@/lib/case-data";
import type { Database } from "@/integrations/supabase/types";

type TimelineEventRow = Database["public"]["Tables"]["timeline_events"]["Row"];

export const Route = createFileRoute("/cases/$caseId/")({
  head: () => ({ meta: [{ title: "Investigation timeline | CargoIQ" }] }),
  component: TimelinePage,
});

function TimelinePage() {
  const data = CaseRoute.useLoaderData();
  const [events, setEvents] = useState(data.timeline);
  const [selectedId, setSelectedId] = useState(data.timeline[0]?.id ?? "");

  useEffect(() => {
    setEvents(data.timeline);
    if (!selectedId && data.timeline[0]) setSelectedId(data.timeline[0].id);
  }, [data.timeline, selectedId]);

  const selected = events.find((e) => e.id === selectedId) ?? events[0];
  const t0 = events.length ? Date.parse(events[0].timestamp) : Date.now();
  const t1 = events.length ? Date.parse(events[events.length - 1].timestamp) : t0 + 1;
  const pos = (s: string) => (t1 === t0 ? 50 : 6 + ((Date.parse(s) - t0) / (t1 - t0)) * 88);

  const docCount = data.documents.length;
  const claimCount = data.claims.length;
  const openCount = data.contradictions.filter((c) => c.status === "FLAGGED").length;
  const disputed = disputedClaimIds(data.contradictions);
  const window = disputedWindow(data.claims, disputed);
  const showNature = (e: TimelineEventRow) =>
    String(e.nature).toLowerCase() !== "disputed" || !isDisputeEvent(e, disputed);
  const verifiedCount = data.claims.filter((c) => c.status === "VERIFIED").length;
  const pendingCount = data.claims.filter((c) => c.status === "PENDING").length;
  const nextAction =
    docCount === 0
      ? "Upload documents"
      : claimCount === 0
        ? "Extract claims"
        : openCount > 0
          ? "Resolve " + openCount + " contradiction" + (openCount === 1 ? "" : "s")
          : pendingCount > 0
            ? "Review " + pendingCount + " unverified claim" + (pendingCount === 1 ? "" : "s")
            : data.packs.length === 0
              ? "Generate the evidence pack"
              : "Review pack";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Documents" value={String(docCount)} />
        <Stat label="Claims extracted" value={String(claimCount)} />
        <Stat
          label="Open contradictions"
          value={String(openCount)}
          tone={openCount ? "disputed" : undefined}
        />
        <Stat
          label="Verified claims"
          value={claimCount ? verifiedCount + " / " + claimCount : "0"}
          tone="observed"
        />
      </div>
      <div className="rounded border border-primary/40 bg-primary/5 px-4 py-3 text-sm">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Next action
        </span>
        <div className="mt-1 font-medium text-primary">{nextAction}</div>
      </div>
      <Panel
        title={
          "Case timeline · " +
          (events.length
            ? new Date(t0).toISOString().slice(0, 10) +
              " – " +
              new Date(t1).toISOString().slice(0, 10)
            : "No events")
        }
      >
        {!events.length ? (
          <div className="py-14 text-center text-sm text-muted-foreground">
            No timeline events yet. Upload records or refresh satellite and marine data.
          </div>
        ) : (
          <>
            {window && (
              <div
                className="mb-3 flex items-center gap-2 rounded border border-disputed/40 bg-disputed/10 px-3 py-2 sm:hidden"
                aria-label="Disputed window"
              >
                <DisputeBadge label="Disputed window" />
                <span className="font-mono text-[11px] text-disputed">
                  {new Date(window.start).toISOString().slice(5, 16).replace("T", " ")}Z –{" "}
                  {new Date(window.end).toISOString().slice(5, 16).replace("T", " ")}Z
                </span>
              </div>
            )}
            <ol aria-label="Timeline events" className="space-y-2 sm:hidden">
              {events.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => setSelectedId(e.id)}
                    className={cn(
                      "w-full rounded border px-3 py-3 text-left",
                      e.id === selected?.id && "border-primary bg-accent",
                      isDisputeEvent(e, disputed) && "border-disputed/40 bg-disputed/5",
                    )}
                  >
                    <span className="block font-mono text-xs text-muted-foreground">
                      {new Date(e.timestamp).toISOString().slice(0, 16).replace("T", " ")}Z
                    </span>
                    <span className="mt-1 block text-sm">{e.title}</span>
                    <span className="mt-2 flex flex-wrap gap-2">
                      {showNature(e) && (
                        <NatureBadge n={String(e.nature).toLowerCase() as Nature} />
                      )}
                      {isDisputeEvent(e, disputed) && <DisputeBadge />}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="relative hidden h-56 sm:block">
              <div className="absolute left-0 right-0 top-1/2 h-px bg-border" />
              {window && t1 > t0 && (
                <div
                  className="absolute top-2 bottom-2 rounded border border-disputed/30 bg-disputed/10"
                  style={{
                    left: pos(new Date(window.start).toISOString()) + "%",
                    width:
                      Math.max(
                        2,
                        pos(new Date(window.end).toISOString()) -
                          pos(new Date(window.start).toISOString()),
                      ) + "%",
                  }}
                  aria-label="Disputed window"
                >
                  <span className="absolute -top-0.5 left-1 font-mono text-[9px] uppercase tracking-widest text-disputed">
                    Disputed window
                  </span>
                </div>
              )}
              {events.map((e, i) => (
                <button
                  key={e.id}
                  onClick={() => setSelectedId(e.id)}
                  className="group absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: pos(e.timestamp) + "%" }}
                >
                  <span
                    className={cn(
                      "block h-3.5 w-3.5 rotate-45 border-2 transition-transform group-hover:scale-125",
                      e.id === selected?.id && "scale-150",
                    )}
                    style={{
                      borderColor: "var(--" + String(e.nature).toLowerCase() + ")",
                      background:
                        e.nature === "INFERRED"
                          ? "transparent"
                          : "var(--" + String(e.nature).toLowerCase() + ")",
                    }}
                  />
                  <span
                    className={
                      "absolute left-1/2 w-24 -translate-x-1/2 whitespace-nowrap rounded bg-card/80 px-1 text-center font-mono text-[10px] leading-tight text-muted-foreground " +
                      ["bottom-6", "top-6", "bottom-[3.75rem]", "top-[3.75rem]"][i % 4]
                    }
                  >
                    {new Date(e.timestamp).toISOString().slice(5, 16).replace("T", " ")}Z
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Panel title={"Event ledger · " + events.length}>
          <ol className="divide-y">
            {events.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => setSelectedId(e.id)}
                  className={cn(
                    "grid w-full grid-cols-1 items-start gap-1 sm:grid-cols-[150px_1fr_auto] sm:items-center sm:gap-4 px-2 py-3 text-left text-sm hover:bg-accent",
                    e.id === selected?.id && "bg-accent",
                  )}
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    {new Date(e.timestamp).toISOString().slice(0, 16).replace("T", " ")}Z
                  </span>
                  <span>
                    {e.title}
                    <span className="block text-xs text-muted-foreground">{e.source}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {isDisputeEvent(e, disputed) && <DisputeBadge />}
                    {showNature(e) && <NatureBadge n={String(e.nature).toLowerCase() as Nature} />}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </Panel>

        <Panel title="Provenance">
          {selected ? (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-2">
                {showNature(selected) && (
                  <NatureBadge n={String(selected.nature).toLowerCase() as Nature} />
                )}
                {isDisputeEvent(selected, disputed) && <DisputeBadge />}
              </div>
              <p className="text-base font-medium">{selected.title}</p>
              <dl className="grid grid-cols-[95px_1fr] gap-y-2 text-xs">
                <dt className="text-muted-foreground">Timestamp</dt>
                <dd className="font-mono">{selected.timestamp} UTC</dd>
                <dt className="text-muted-foreground">Source</dt>
                <dd>{selected.source}</dd>
                <dt className="text-muted-foreground">Class</dt>
                <dd>
                  <ClassTag c={selected.evidence_class} />
                </dd>
                <dt className="text-muted-foreground">Coordinates</dt>
                <dd className="font-mono">
                  {selected.coordinates ? JSON.stringify(selected.coordinates) : "—"}
                </dd>
              </dl>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Select an event.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}
