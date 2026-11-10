import { useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { ClassTag, DisputeBadge, NatureBadge } from "@/components/ui-kit";
import { cn } from "@/lib/utils";
import { isDisputeEvent } from "@/lib/dispute";
import { type Nature } from "@/lib/case-data";
import type { Database } from "@/integrations/supabase/types";

type TimelineEventRow = Database["public"]["Tables"]["timeline_events"]["Row"];
type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];

const natureVar = (n: string) => "var(--" + n.toLowerCase() + ")";

function docTypeChip(fileType: string): string {
  const t = fileType.toLowerCase();
  if (t.includes("pdf")) return "PDF";
  if (t.includes("image") || t.includes("png") || t.includes("jpg") || t.includes("jpeg"))
    return "IMG";
  if (t.includes("csv") || t.includes("sheet") || t.includes("excel")) return "CSV";
  if (t.includes("mail") || t.includes("eml") || t.includes("msg")) return "MAIL";
  return "DOC";
}

function matchingDocuments(source: string, documents: DocumentRow[]): DocumentRow[] {
  const tokens = source
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3);
  if (!tokens.length) return [];
  return documents
    .filter((d) => {
      const hay = (d.name + " " + (d.source_party ?? "")).toLowerCase();
      return tokens.some((t) => hay.includes(t));
    })
    .slice(0, 5);
}

export function EvidenceTimeline({
  events,
  disputed,
  selectedId,
  onSelect,
}: {
  events: TimelineEventRow[];
  disputed: Set<string>;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}) {
  if (!events.length) {
    return (
      <div className="rounded-2xl border bg-card py-14 text-center text-base text-muted-foreground">
        No timeline events yet. Upload records or refresh satellite and marine data.
      </div>
    );
  }
  return (
    <ol aria-label="Evidence timeline" className="relative ml-2 space-y-4">
      <span aria-hidden="true" className="absolute bottom-4 left-[13px] top-4 w-0.5 bg-border" />
      {events.map((e) => {
        const isDisputed = isDisputeEvent(e, disputed);
        const nature = String(e.nature).toLowerCase() as Nature;
        const showNature = nature !== "disputed" || !isDisputed;
        return (
          <li key={e.id} className="relative flex items-start gap-4">
            <span
              aria-hidden="true"
              className={cn(
                "relative z-10 mt-4 grid h-7 w-7 flex-none place-items-center rounded-full border-2 bg-card",
                isDisputed ? "border-disputed" : "border-border",
              )}
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: natureVar(isDisputed ? "disputed" : nature) }}
              />
            </span>
            <button
              type="button"
              onClick={() => onSelect(e.id)}
              aria-current={e.id === selectedId ? "true" : undefined}
              className={cn(
                "flex-1 rounded-2xl border bg-card px-4 py-3.5 text-left transition-colors hover:bg-accent",
                e.id === selectedId && "border-primary",
                isDisputed && "border-disputed/40 bg-disputed/5",
              )}
            >
              <span className="block text-[13px] font-bold uppercase tracking-wider text-primary">
                {new Date(e.timestamp).toISOString().slice(0, 16).replace("T", " ")}Z
              </span>
              <span className="mt-1 block text-base font-semibold">{e.title}</span>
              <span className="mt-2.5 flex flex-wrap items-center gap-2">
                {e.source && (
                  <span className="rounded-md bg-secondary px-2.5 py-1 text-sm text-muted-foreground">
                    {e.source}
                  </span>
                )}
                {showNature && <NatureBadge n={nature} />}
                {isDisputed && <DisputeBadge />}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function EvidenceSourceDrawer({
  open,
  event,
  documents,
  caseId,
  disputed,
  onClose,
}: {
  open: boolean;
  event: TimelineEventRow | undefined;
  documents: DocumentRow[];
  caseId: string;
  disputed: Set<string>;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !event) return null;

  const isDisputed = isDisputeEvent(event, disputed);
  const nature = String(event.nature).toLowerCase() as Nature;
  const matches = matchingDocuments(event.source ?? "", documents);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Sources">
      <button
        type="button"
        aria-label="Close sources"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 drawer-scrim"
      />
      <aside className="drawer-panel absolute inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto rounded-t-2xl border-t bg-card p-5 pb-8 sm:inset-y-0 sm:left-auto sm:max-h-none sm:w-[380px] sm:rounded-none sm:border-l sm:border-t-0">
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border sm:hidden" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Sources</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {event.title} · {new Date(event.timestamp).toISOString().slice(0, 10)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 flex-none place-items-center rounded-lg border text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <NatureBadge n={nature} />
          {isDisputed && <DisputeBadge />}
          <ClassTag c={event.evidence_class} />
        </div>

        <dl className="mt-4 grid grid-cols-[110px_1fr] gap-y-2 text-sm">
          <dt className="text-muted-foreground">Timestamp</dt>
          <dd className="font-mono">{event.timestamp} UTC</dd>
          <dt className="text-muted-foreground">Source</dt>
          <dd>{event.source || "—"}</dd>
          <dt className="text-muted-foreground">Coordinates</dt>
          <dd className="font-mono">
            {event.coordinates ? JSON.stringify(event.coordinates) : "—"}
          </dd>
        </dl>

        <h3 className="mt-6 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Matching documents
        </h3>
        {matches.length ? (
          <ul className="mt-3 space-y-2.5">
            {matches.map((d) => (
              <li key={d.id} className="flex items-center gap-3 rounded-xl border px-3 py-2.5">
                <span className="grid h-8 w-11 flex-none place-items-center rounded-md bg-secondary text-[11px] font-extrabold tracking-wide text-primary">
                  {docTypeChip(d.file_type)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{d.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {d.source_party ?? "Unattributed"} ·{" "}
                    {new Date(d.uploaded_at).toISOString().slice(0, 10)}
                  </span>
                </span>
                <Link
                  to="/cases/$caseId/documents"
                  params={{ caseId }}
                  className="flex-none text-sm font-bold text-primary"
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No uploaded document matches this source yet.{" "}
            <Link to="/cases/$caseId/documents" params={{ caseId }} className="text-primary">
              Open documents
            </Link>
          </p>
        )}
      </aside>
    </div>
  );
}
