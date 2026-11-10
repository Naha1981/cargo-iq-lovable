import { Route as CaseRoute } from "./cases.$caseId";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Panel, Stat, NatureBadge, ClassTag, DisputeBadge } from "@/components/ui-kit";
import { EvidenceTimeline, EvidenceSourceDrawer } from "@/components/EvidenceTimeline";
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
  const navigate = useNavigate();
  const [events, setEvents] = useState(data.timeline);
  const [selectedId, setSelectedId] = useState(data.timeline[0]?.id ?? "");
  const [view, setView] = useState<"timeline" | "list">("timeline");
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setEvents(data.timeline);
    if (!selectedId && data.timeline[0]) setSelectedId(data.timeline[0].id);
  }, [data.timeline, selectedId]);

  const selected = events.find((e) => e.id === selectedId) ?? events[0];

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

  const viewBtn = (active: boolean) =>
    cn(
      "min-h-11 flex-1 rounded-lg px-4 text-base font-semibold transition-colors sm:flex-none sm:px-6",
      active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
    );

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
      <div className="rounded border border-primary/40 bg-primary/5 px-4 py-3 text-base">
        <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Next action
        </span>
        <div className="mt-1 font-medium text-primary">{nextAction}</div>
        {docCount === 0 && (
          <Link
            to="/cases/$caseId/documents"
            params={{ caseId: data.case.id }}
            className="mt-3 inline-flex rounded-md bg-primary px-4 py-2 text-primary-foreground"
          >
            Upload your first document
          </Link>
        )}
      </div>

      <div
        role="group"
        aria-label="Evidence view"
        className="flex w-full gap-1.5 rounded-xl bg-secondary p-1.5 sm:w-auto sm:inline-flex"
      >
        <button
          type="button"
          aria-pressed={view === "timeline"}
          onClick={() => setView("timeline")}
          className={viewBtn(view === "timeline")}
        >
          Timeline
        </button>
        <button
          type="button"
          onClick={() =>
            void navigate({ to: "/cases/$caseId/map", params: { caseId: data.case.id } })
          }
          className={viewBtn(false)}
        >
          Map
        </button>
        <button
          type="button"
          aria-pressed={view === "list"}
          onClick={() => setView("list")}
          className={viewBtn(view === "list")}
        >
          List
        </button>
      </div>

      {window && (
        <div
          className="flex items-center gap-2 rounded border border-disputed/40 bg-disputed/10 px-3 py-2"
          aria-label="Disputed window"
        >
          <DisputeBadge label="Disputed window" />
          <span className="font-mono text-xs text-disputed">
            {new Date(window.start).toISOString().slice(5, 16).replace("T", " ")}Z –{" "}
            {new Date(window.end).toISOString().slice(5, 16).replace("T", " ")}Z
          </span>
        </div>
      )}

      {view === "timeline" ? (
        <EvidenceTimeline
          events={events}
          disputed={disputed}
          selectedId={selected?.id}
          onSelect={(id) => {
            setSelectedId(id);
            setDrawerOpen(true);
          }}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <Panel title={"Event ledger · " + events.length}>
            <ol className="divide-y">
              {events.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => {
                      setSelectedId(e.id);
                      setDrawerOpen(true);
                    }}
                    className={cn(
                      "grid w-full grid-cols-1 items-start gap-1 sm:grid-cols-[150px_1fr_auto] sm:items-center sm:gap-4 px-2 py-3 text-left text-base hover:bg-accent",
                      e.id === selected?.id && "bg-accent",
                    )}
                  >
                    <span className="font-mono text-sm text-muted-foreground">
                      {new Date(e.timestamp).toISOString().slice(0, 16).replace("T", " ")}Z
                    </span>
                    <span>
                      {e.title}
                      <span className="block text-sm text-muted-foreground">{e.source}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      {isDisputeEvent(e, disputed) && <DisputeBadge />}
                      {showNature(e) && (
                        <NatureBadge n={String(e.nature).toLowerCase() as Nature} />
                      )}
                    </span>
                  </button>
                </li>
              ))}
              {!events.length && (
                <li className="py-14 text-center text-base text-muted-foreground">
                  No timeline events yet. Upload records or refresh satellite and marine data.
                </li>
              )}
            </ol>
          </Panel>

          <Panel title="Provenance">
            {selected ? (
              <div className="space-y-4 text-base">
                <div className="flex flex-wrap gap-2">
                  {showNature(selected) && (
                    <NatureBadge n={String(selected.nature).toLowerCase() as Nature} />
                  )}
                  {isDisputeEvent(selected, disputed) && <DisputeBadge />}
                </div>
                <p className="text-base font-medium">{selected.title}</p>
                <dl className="grid grid-cols-[95px_1fr] gap-y-2 text-sm">
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
              <p className="text-base text-muted-foreground">Select an event.</p>
            )}
          </Panel>
        </div>
      )}

      <EvidenceSourceDrawer
        open={drawerOpen}
        event={selected}
        documents={data.documents}
        caseId={data.case.id}
        disputed={disputed}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
