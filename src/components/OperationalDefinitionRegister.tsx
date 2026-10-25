import { useEffect, useState } from "react";
import {
  listOperationalDefinitions,
  addOperationalDefinition,
} from "@/lib/operational-definitions.functions";
import { latestDefinitions, definitionInput } from "@/lib/operational-definitions";
const blank = {
  party: "",
  metric: "HATCH_COVER",
  unit: "",
  rule: "",
  originalSourceText: "",
  sourceDocumentId: "",
  sourceReference: "",
  effectiveFrom: "",
  effectiveTo: "",
  acceptance: "UNRESOLVED",
  acceptanceBasis: "",
  supersedesId: null as string | null,
};
export function OperationalDefinitionRegister({
  caseId,
  documents,
}: {
  caseId: string;
  documents: any[];
}) {
  const [rows, setRows] = useState<any[]>([]),
    [form, setForm] = useState(blank),
    [history, setHistory] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setRows([]);
    listOperationalDefinitions({ data: { caseId } })
      .then((r) => {
        if (active) setRows(r);
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : "Could not load definitions");
      });
    return () => {
      active = false;
    };
  }, [caseId]);
  function field(k: keyof typeof blank, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const input = definitionInput.parse({
        ...form,
        caseId,
        effectiveTo: form.effectiveTo || null,
      });
      await addOperationalDefinition({ data: input });
      setRows(await listOperationalDefinitions({ data: { caseId } }));
      setForm(blank);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Definition was not saved");
    } finally {
      setBusy(false);
    }
  }
  function revise(r: any) {
    setForm({
      party: r.party,
      metric: r.metric,
      unit: r.unit,
      rule: r.rule,
      originalSourceText: r.original_source_text,
      sourceDocumentId: r.source_document_id,
      sourceReference: r.source_reference,
      effectiveFrom: r.effective_from,
      effectiveTo: r.effective_to ?? "",
      acceptance: r.acceptance,
      acceptanceBasis: r.acceptance_basis,
      supersedesId: r.id,
    });
  }
  const shown = history ? rows : latestDefinitions(rows);
  const inputClass = "mt-1 w-full rounded border bg-background p-2 text-sm";
  return (
    <section className="rounded-lg border bg-card p-4 sm:p-5">
      <h2 className="text-lg font-semibold">Operational definition register</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Compare each organization's definition without rewriting its reported counts. Agreement
        labels record a human assertion with supporting evidence, not an automatic legal finding.
        Different units are review topics, not factual contradictions.
      </p>
      {error && (
        <p role="alert" className="mt-3 rounded border border-disputed p-3 text-sm text-disputed">
          {error}
        </p>
      )}
      <label className="my-4 flex gap-2 text-sm">
        <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
        Show all immutable versions
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        {shown.map((r) => (
          <article key={r.id} className="min-w-0 rounded border p-4">
            <h3 className="font-semibold break-words">
              {r.party} · {r.metric.replaceAll("_", " ")}
            </h3>
            <p className="mt-1 font-mono text-xs">
              v{r.version} · {r.acceptance.replaceAll("_", " ")}
            </p>
            <p className="mt-3 text-sm">
              <strong>Counting unit:</strong> {r.unit}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{r.rule}</p>
            <blockquote className="mt-3 border-l-2 pl-3 text-sm">
              <span className="text-xs text-muted-foreground">Original source text</span>
              <p className="mt-1 whitespace-pre-wrap">{r.original_source_text}</p>
            </blockquote>
            <p className="mt-3 text-xs break-words">
              Source:{" "}
              {documents.find((d) => d.id === r.source_document_id)?.name ?? r.source_document_id} ·{" "}
              {r.source_reference}
            </p>
            <p className="mt-2 text-xs">
              Effective: {r.effective_from} to {r.effective_to ?? "open-ended"} (stored instants,
              UTC display)
            </p>
            <p className="mt-2 text-xs">Acceptance basis: {r.acceptance_basis}</p>
            <button
              type="button"
              onClick={() => revise(r)}
              className="mt-3 rounded border px-3 py-2 text-xs"
            >
              Prepare new version
            </button>
          </article>
        ))}
      </div>
      {!shown.length && (
        <p className="my-4 text-sm text-muted-foreground">
          No definitions recorded. Missing definitions do not establish a counting error.
        </p>
      )}
      <details className="mt-5 rounded border p-4" open={!!form.supersedesId}>
        <summary className="cursor-pointer text-sm font-semibold">
          {form.supersedesId
            ? "Append a version (prior version remains unchanged)"
            : "Record a source-backed definition"}
        </summary>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            Source organization
            <input
              className={inputClass}
              value={form.party}
              onChange={(e) => field("party", e.target.value)}
              maxLength={200}
              disabled={!!form.supersedesId}
            />
          </label>
          <label className="text-sm">
            Measure
            <select
              className={inputClass}
              value={form.metric}
              onChange={(e) => field("metric", e.target.value)}
              disabled={!!form.supersedesId}
            >
              {["HATCH_COVER", "TRUCK_VISIT", "CONTAINER_DELIVERY", "GATE_COUNT", "OTHER"].map(
                (x) => (
                  <option key={x}>{x}</option>
                ),
              )}
            </select>
          </label>
          <label className="text-sm">
            Counting unit
            <input
              className={inputClass}
              value={form.unit}
              onChange={(e) => field("unit", e.target.value)}
              placeholder="Individual lift, grouped operation, truck visit..."
              maxLength={100}
            />
          </label>
          <label className="text-sm">
            Acceptance status
            <select
              className={inputClass}
              value={form.acceptance}
              onChange={(e) => field("acceptance", e.target.value)}
            >
              {["CONTRACTUALLY_SPECIFIED", "AGREED", "PARTY_REPORTED", "UNRESOLVED"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className="text-sm md:col-span-2">
            Operational rule
            <textarea
              className={inputClass}
              value={form.rule}
              onChange={(e) => field("rule", e.target.value)}
              maxLength={4000}
            />
          </label>
          <label className="text-sm md:col-span-2">
            Original source wording (preserved)
            <textarea
              className={inputClass}
              value={form.originalSourceText}
              onChange={(e) => field("originalSourceText", e.target.value)}
              maxLength={8000}
            />
          </label>
          <label className="text-sm">
            Source document
            <select
              className={inputClass}
              value={form.sourceDocumentId}
              onChange={(e) => field("sourceDocumentId", e.target.value)}
            >
              <option value="">Select case document</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Page / row / section
            <input
              className={inputClass}
              value={form.sourceReference}
              onChange={(e) => field("sourceReference", e.target.value)}
              maxLength={1000}
            />
          </label>
          <label className="text-sm">
            Effective from (ISO timestamp + offset)
            <input
              className={inputClass}
              value={form.effectiveFrom}
              onChange={(e) => field("effectiveFrom", e.target.value)}
              placeholder="2026-10-15T00:00:00+02:00"
            />
          </label>
          <label className="text-sm">
            Effective to (optional ISO timestamp + offset)
            <input
              className={inputClass}
              value={form.effectiveTo}
              onChange={(e) => field("effectiveTo", e.target.value)}
              placeholder="Open-ended if blank"
            />
          </label>
          <label className="text-sm md:col-span-2">
            Evidence for acceptance status
            <textarea
              className={inputClass}
              value={form.acceptanceBasis}
              onChange={(e) => field("acceptanceBasis", e.target.value)}
              placeholder="Which terms/agreement support this label? For unresolved, explain what is missing."
              maxLength={2000}
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Saving..." : "Append evidenced definition"}
          </button>
          <button
            type="button"
            onClick={() => setForm(blank)}
            className="rounded border px-4 py-2 text-sm"
          >
            Clear draft
          </button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          For an existing party and measure, prepare a new version from its latest card. No source
          counts are changed and no unit conversion is applied automatically.
        </p>
      </details>
    </section>
  );
}
