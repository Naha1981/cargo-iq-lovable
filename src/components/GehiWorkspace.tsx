import { useCallback, useEffect, useState } from "react";
import { Panel, Button } from "@/components/ui-kit";
import {
  createGeospatialFinding,
  listGeospatialFindings,
  reviewGeospatialFinding,
} from "@/lib/gehi.functions";
import { CONFIDENCES, timeRelationLabel, type TimeRelation } from "@/lib/gehi";
import { renderInvestigationReport } from "@/lib/gehi-report";
import { CorridorMap } from "@/components/CorridorView";
import type { CorridorEvent } from "@/lib/corridor";
import { RecordedImageryComparison } from "@/components/RecordedImageryComparison";
import type { RecordedImagery } from "@/lib/imagery-comparison";
import type { Database } from "@/integrations/supabase/types";

type FindingRow = Database["public"]["Tables"]["geospatial_findings"]["Row"] & {
  timeRelation?: TimeRelation;
};

const toneFor = (s: string) =>
  s === "confirmed"
    ? "bg-emerald-500/15 text-emerald-400"
    : s === "rejected"
      ? "bg-red-500/15 text-red-400"
      : s === "under_review"
        ? "bg-amber-500/15 text-amber-400"
        : "bg-slate-500/15 text-slate-400";

export function GehiWorkspace({
  caseId,
  portCode,
  initialFindings,
  fixtureLabel,
  observations = [],
}: {
  caseId: string;
  observations?: RecordedImagery[];
  portCode: string | null;
  /** Fixture mode (harness/tests): render these rows, skip server fetch. */
  initialFindings?: FindingRow[];
  fixtureLabel?: string;
}) {
  const [findings, setFindings] = useState<FindingRow[]>(initialFindings ?? []);
  const [selected, setSelected] = useState<FindingRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [method, setMethod] = useState("");
  const [confidence, setConfidence] = useState<string>("unverified");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [eventTime, setEventTime] = useState("");
  const [observationTime, setObservationTime] = useState("");
  const [limitations, setLimitations] = useState("");
  const [alternatives, setAlternatives] = useState("");
  const [rationale, setRationale] = useState("");

  const refresh = useCallback(async () => {
    const rows = await listGeospatialFindings({ data: { caseId } });
    setFindings(rows as FindingRow[]);
  }, [caseId]);

  useEffect(() => {
    if (initialFindings) return;
    refresh().catch((e: Error) => setError(e.message));
  }, [refresh, initialFindings]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const mapEvents: CorridorEvent[] = findings
    .filter((f) => f.latitude != null && f.longitude != null)
    .map((f) => ({
      id: f.id,
      latitude: f.latitude!,
      longitude: f.longitude!,
      observedAt: f.observation_time ?? "",
      source: f.source,
      state:
        f.review_status === "confirmed"
          ? ("observed" as const)
          : f.confidence === "unverified"
            ? ("unknown" as const)
            : ("inferred" as const),
      severity: f.confidence === "low" || f.confidence === "unverified" ? "warning" : "info",
      title: f.title,
    }));

  return (
    <div className="space-y-6">
      {fixtureLabel && (
        <p className="rounded bg-amber-500/20 px-2 py-1 text-xs font-semibold uppercase text-amber-400">
          {fixtureLabel}
        </p>
      )}
      <RecordedImageryComparison observations={observations} />
      <Panel title="Geospatial Evidence Workspace">
        <p className="mb-4 text-xs text-muted-foreground">
          Provenance-preserving findings: every record carries source, method, confidence and the
          reasoning behind it. Facts stay distinct from inferences; missing imagery stays an
          explicit gap. Confirmation requires review plus recorded rationale.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">New finding</h3>
            <input
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              placeholder="Finding title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <input
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              placeholder="Source (e.g. port authority advisory, customer photo)"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
            <input
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              placeholder="Method (e.g. visual inspection, AIS cross-check)"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            />
            <div className="flex gap-2">
              <input
                className="w-1/2 rounded border bg-background px-2 py-1.5 text-sm"
                placeholder="Latitude (optional)"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
              />
              <input
                className="w-1/2 rounded border bg-background px-2 py-1.5 text-sm"
                placeholder="Longitude (optional)"
                value={lon}
                onChange={(e) => setLon(e.target.value)}
              />
            </div>
            <select
              className="rounded border bg-background px-2 py-1.5 text-sm"
              value={confidence}
              onChange={(e) => setConfidence(e.target.value)}
            >
              {CONFIDENCES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <label className="block text-xs">
              Event time (local)
              <input
                type="datetime-local"
                className="mt-1 w-full rounded border bg-background p-2"
                value={eventTime}
                onChange={(e) => setEventTime(e.target.value)}
              />
            </label>
            <label className="block text-xs">
              Observation/capture time (local)
              <input
                type="datetime-local"
                className="mt-1 w-full rounded border bg-background p-2"
                value={observationTime}
                onChange={(e) => setObservationTime(e.target.value)}
              />
            </label>
            <textarea
              className="w-full rounded border bg-background p-2 text-sm"
              placeholder="Limitations (resolution, coverage, occlusion, source uncertainty)"
              value={limitations}
              onChange={(e) => setLimitations(e.target.value)}
            />
            <textarea
              className="w-full rounded border bg-background p-2 text-sm"
              placeholder="Alternative explanations"
              value={alternatives}
              onChange={(e) => setAlternatives(e.target.value)}
            />
            <Button
              disabled={busy || !title.trim() || !source.trim() || !method.trim()}
              onClick={() =>
                run(async () => {
                  await createGeospatialFinding({
                    data: {
                      caseId,
                      title: title.trim(),
                      source: source.trim(),
                      method: method.trim(),
                      confidence: confidence as never,
                      eventTime: eventTime ? new Date(eventTime).toISOString() : undefined,
                      observationTime: observationTime
                        ? new Date(observationTime).toISOString()
                        : undefined,
                      limitations: limitations.trim() || undefined,
                      alternatives: alternatives.trim() || undefined,
                      latitude: lat.trim() ? Number(lat) : undefined,
                      longitude: lon.trim() ? Number(lon) : undefined,
                    },
                  });
                  setTitle("");
                  setSource("");
                  setMethod("");
                  setLat("");
                  setLon("");
                })
              }
            >
              Record finding
            </Button>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Findings ({findings.length})</h3>
              <Button
                disabled={findings.length === 0}
                onClick={() => {
                  const text = renderInvestigationReport({
                    caseRef: caseId,
                    generatedAt: new Date().toISOString(),
                    findings: findings.map((f) => ({
                      title: f.title,
                      source: f.source,
                      method: f.method,
                      confidence: f.confidence as never,
                      review_status: f.review_status as never,
                      review_rationale: f.rationale,
                      observation_time: f.observation_time,
                      timeRelation: f.timeRelation,
                      latitude: f.latitude,
                      longitude: f.longitude,
                      created_at: f.created_at,
                      limitations: f.limitations,
                      alternatives: f.alternatives,
                    })),
                  });
                  const blob = new Blob([text], { type: "text/plain" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `geospatial-investigation-${caseId}.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download investigation report
              </Button>
            </div>
            {findings.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No geospatial findings for this case yet.
              </p>
            )}
            {findings.map((f) => (
              <button
                key={f.id}
                onClick={() => setSelected(f)}
                className="block w-full rounded border px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{f.title}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${toneFor(f.review_status)}`}
                  >
                    {f.review_status}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {f.method} · confidence {f.confidence} ·{" "}
                  {new Date(f.created_at).toLocaleDateString("en-GB")}
                </div>
              </button>
            ))}
          </div>
        </div>
      </Panel>

      <CorridorMap events={mapEvents} portCode={portCode} />

      {selected && (
        <Panel title={"Finding: " + selected.title}>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-muted-foreground">Review status</dt>
            <dd className="font-semibold uppercase">{selected.review_status}</dd>
            <dt className="text-muted-foreground">Confidence</dt>
            <dd>{selected.confidence}</dd>
            <dt className="text-muted-foreground">Source</dt>
            <dd>{selected.source}</dd>
            <dt className="text-muted-foreground">Method</dt>
            <dd>{selected.method}</dd>
            <dt className="text-muted-foreground">Temporal correlation</dt>
            <dd>{selected.timeRelation ? timeRelationLabel(selected.timeRelation) : "unknown"}</dd>
            <dt className="text-muted-foreground">Rationale</dt>
            <dd>{selected.rationale ?? "not recorded"}</dd>
            <dt className="text-muted-foreground">Alternatives considered</dt>
            <dd>{selected.alternatives ?? "not recorded"}</dd>
            <dt className="text-muted-foreground">Limitations</dt>
            <dd>{selected.limitations ?? "not recorded"}</dd>
            <dt className="text-muted-foreground">Next action</dt>
            <dd>{selected.next_action ?? "none recorded"}</dd>
          </dl>
          <div className="mt-4 space-y-2 border-t pt-3">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">Review</h4>
            <textarea
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              rows={2}
              placeholder="Rationale (required before confirming)"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
            />
            <div className="flex gap-2">
              {selected.review_status === "draft" && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await reviewGeospatialFinding({
                        data: { findingId: selected.id, to: "under_review" },
                      });
                    })
                  }
                >
                  Start review
                </Button>
              )}
              {selected.review_status === "under_review" && (
                <>
                  <Button
                    disabled={busy || !rationale.trim()}
                    onClick={() =>
                      run(async () => {
                        await reviewGeospatialFinding({
                          data: {
                            findingId: selected.id,
                            to: "confirmed",
                            rationale: rationale.trim(),
                          },
                        });
                      })
                    }
                  >
                    Confirm (requires rationale)
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await reviewGeospatialFinding({
                          data: { findingId: selected.id, to: "rejected" },
                        });
                      })
                    }
                  >
                    Reject
                  </Button>
                </>
              )}
              {selected.review_status === "rejected" && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await reviewGeospatialFinding({
                        data: { findingId: selected.id, to: "under_review" },
                      });
                    })
                  }
                >
                  Reopen review
                </Button>
              )}
            </div>
          </div>
        </Panel>
      )}

      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
