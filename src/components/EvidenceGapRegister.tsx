import { useEffect, useState } from "react";
import { gapStates, gapInput, latestGaps } from "@/lib/evidence-gaps";
import { listEvidenceGaps, appendEvidenceGap } from "@/lib/evidence-gaps.functions";
const blank = {
  physicalReference: "",
  requiredEvent: "",
  requirementBasis: "",
  status: "EXPECTED",
  explanation: "",
  documentIds: [] as string[],
  evidenceReference: "",
  supersedesId: null as string | null,
};
export function EvidenceGapRegister({ caseId, documents }: { caseId: string; documents: any[] }) {
  const [rows, setRows] = useState<any[]>([]),
    [f, setF] = useState(blank),
    [err, setErr] = useState(""),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState(false);
  useEffect(() => {
    let active = true;
    listEvidenceGaps({ data: { caseId } })
      .then((r) => {
        if (active) setRows(r);
      })
      .catch((e) => {
        if (active) setErr(e.message);
      });
    return () => {
      active = false;
    };
  }, [caseId]);
  function edit(k: keyof typeof blank, v: any) {
    setF((x) => ({ ...x, [k]: v }));
  }
  async function save() {
    setBusy(true);
    setErr("");
    try {
      await appendEvidenceGap({ data: gapInput.parse({ ...f, caseId }) });
      setRows(await listEvidenceGaps({ data: { caseId } }));
      setF(blank);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gap state not saved");
    } finally {
      setBusy(false);
    }
  }
  function revise(r: any) {
    setF({
      physicalReference: r.physical_reference,
      requiredEvent: r.required_event,
      requirementBasis: r.requirement_basis,
      status: r.status,
      explanation: r.explanation,
      documentIds: r.document_ids,
      evidenceReference: r.evidence_reference,
      supersedesId: r.id,
    });
  }
  const cl = "mt-1 w-full rounded border bg-background p-2 text-sm",
    shown = history ? rows : latestGaps(rows);
  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-xl font-semibold">Show the gap, not invented facts</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Track expected, received, conflicting and missing evidence for each required event.
          Missing means not supplied or not established in this case file. It never proves the
          physical event did not happen.
        </p>
      </header>
      {err && (
        <p role="alert" className="rounded border border-disputed p-3 text-sm">
          {err}
        </p>
      )}
      <label className="flex gap-2 text-sm">
        <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
        Show all state versions
      </label>
      <div className="grid gap-4 md:grid-cols-2">
        {shown.map((r) => (
          <article key={r.id} className="rounded-lg border bg-card p-5">
            <p className="font-mono text-xs text-muted-foreground">
              {r.physical_reference} · v{r.version}
            </p>
            <h3 className="mt-2 font-semibold">{r.required_event}</h3>
            <p className="mt-3 text-sm">Evidence state: {r.status} (human recorded)</p>
            <p className="mt-3 whitespace-pre-wrap text-sm">{r.explanation}</p>
            <p className="mt-3 text-xs text-muted-foreground">
              Why required: {r.requirement_basis}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Evidence:{" "}
              {r.document_ids
                .map((id: string) => documents.find((d) => d.id === id)?.name ?? id)
                .join(", ") || "No source received"}{" "}
              · {r.evidence_reference}
            </p>
            {r.status === "MISSING" && (
              <p className="mt-3 text-xs">
                Not evidence of non-occurrence. No responsibility inferred.
              </p>
            )}
            <button
              type="button"
              onClick={() => revise(r)}
              className="mt-4 rounded border px-3 py-2 text-xs"
            >
              Append updated evidence state
            </button>
          </article>
        ))}
      </div>
      {!shown.length && (
        <p className="rounded border p-5 text-sm text-muted-foreground">
          No evidence requirements registered. This is not a complete-evidence finding.
        </p>
      )}
      <details className="rounded-lg border bg-card p-5" open={!!f.supersedesId}>
        <summary className="cursor-pointer text-sm font-semibold">
          Record an evidence requirement or state update
        </summary>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {[
            ["physicalReference", "Physical event / vessel / visit reference"],
            ["requiredEvent", "Required event evidence"],
            ["evidenceReference", "Source page/row or explicit missing reference"],
          ].map(([k, l]) => (
            <label key={k} className="text-sm">
              {l}
              <input
                className={cl}
                value={String(f[k as keyof typeof blank] ?? "")}
                onChange={(e) => edit(k as keyof typeof blank, e.target.value)}
                disabled={!!f.supersedesId && ["physicalReference", "requiredEvent"].includes(k)}
              />
            </label>
          ))}
          <label className="text-sm">
            Evidence state
            <select
              className={cl}
              value={f.status}
              onChange={(e) => edit("status", e.target.value)}
            >
              {gapStates.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="text-sm md:col-span-2">
            Why this evidence is required
            <textarea
              className={cl}
              value={f.requirementBasis}
              onChange={(e) => edit("requirementBasis", e.target.value)}
              maxLength={4000}
            />
          </label>
          <label className="text-sm md:col-span-2">
            State explanation and limitations
            <textarea
              className={cl}
              value={f.explanation}
              onChange={(e) => edit("explanation", e.target.value)}
              maxLength={4000}
            />
          </label>
          <label className="text-sm md:col-span-2">
            Received case documents (required for RECEIVED/CONFLICTING)
            <select
              multiple
              size={4}
              className={cl}
              value={f.documentIds}
              onChange={(e) =>
                edit(
                  "documentIds",
                  Array.from(e.target.selectedOptions, (o) => o.value),
                )
              }
            >
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Saving..." : "Append evidence state"}
          </button>
          <button
            type="button"
            onClick={() => setF(blank)}
            className="rounded border px-4 py-2 text-sm"
          >
            Clear draft
          </button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          History is preserved. A received document is not automatically verified evidence; a
          conflicting state does not create an invented timestamp contradiction.
        </p>
      </details>
    </section>
  );
}
