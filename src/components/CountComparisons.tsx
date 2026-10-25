import { useCallback, useEffect, useState } from "react";
import {
  countComparisonInput,
  evaluateCountComparison,
  type CountComparison,
} from "@/lib/count-comparisons";
import { appendCountComparison, listCountComparisons } from "@/lib/count-comparisons.functions";
import {
  countMetrics,
  latestCountVersions,
  type CountRecord,
  type CountRule,
} from "@/lib/count-ledger";
const cl = "mt-1 w-full min-w-0 rounded border bg-background p-2 text-sm";
export function CountComparisons({
  caseId,
  documents,
  records,
  rules,
}: {
  caseId: string;
  documents: any[];
  records: CountRecord[];
  rules: CountRule[];
}) {
  const blank = {
    caseId,
    name: "",
    metric: "HATCH_COVER",
    outputUnit: "",
    ruleIds: [] as string[],
    physicalReferences: [] as string[],
    kpiDefinitionId: null,
    acceptance: "UNRESOLVED",
    rationale: "",
    sourceDocumentId: "",
    sourceReference: "",
    supersedesId: null,
  };
  const [form, setForm] = useState<any>(blank),
    [scope, setScope] = useState(""),
    [ctx, setCtx] = useState<{
      comparisons: CountComparison[];
      kpis: any[];
      clocks: any[];
      decisions: any[];
    }>({ comparisons: [], kpis: [], clocks: [], decisions: [] }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setCtx(await listCountComparisons({ data: { caseId } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [caseId]);
  useEffect(() => {
    void load();
  }, [load]);
  async function save() {
    setBusy(true);
    setError("");
    try {
      await appendCountComparison({
        data: countComparisonInput.parse({
          ...form,
          physicalReferences: scope
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      setForm(blank);
      setScope("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  function field(key: string, label: string) {
    return (
      <label className="min-w-0 text-sm" key={key}>
        {label}
        <input
          className={cl}
          value={form[key]}
          onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        />
      </label>
    );
  }
  const currentRules = latestCountVersions(rules);
  return (
    <section className="min-w-0 space-y-4 rounded border p-4">
      <h3 className="text-lg">Common-unit comparison and quantity productivity</h3>
      <p className="text-sm text-muted-foreground">
        Select explicit mappings for each source basis, one agreed physical scope and an exact
        common unit. For example, map lifts by 1/4 and operations by 1 only when those source-backed
        rules are agreed. Parties are never added together. Quantity per hour requires a positive
        reconciled clock for exactly the same scope. No universal KPI or fault is inferred.
      </p>
      {error && (
        <p role="alert" className="break-words text-sm">
          {error}
        </p>
      )}
      {latestCountVersions(ctx.comparisons).map((def) => {
        const result = evaluateCountComparison(
          def,
          records,
          rules,
          ctx.kpis,
          ctx.clocks,
          ctx.decisions,
        );
        return (
          <article key={def.id} className="min-w-0 rounded border p-3 text-sm">
            <h4>
              {def.name} · v{def.version} ·{" "}
              {result.comparable ? "COMPARABLE DERIVED VALUES" : "COMPARISON WITHHELD"}
            </h4>
            <p className="mt-1 break-words">
              Scope: {def.physicalReferences.join(", ")} · {def.acceptance}
            </p>
            {result.issues.map((x) => (
              <p className="mt-1" key={x}>
                {x}
              </p>
            ))}
            {result.results.map((r) => (
              <div key={r.party} className="mt-3 rounded bg-secondary p-3">
                <p>
                  {r.party}: {r.total === null ? "WITHHELD" : `${r.total} ${def.outputUnit}`}
                </p>
                {r.reasons.map((x) => (
                  <p className="mt-1" key={x}>
                    {x}
                  </p>
                ))}
                {def.kpiDefinitionId && (
                  <p className="mt-1">
                    Productivity:{" "}
                    {r.perHour === null
                      ? "WITHHELD"
                      : `${r.perHour.toFixed(3)} ${def.outputUnit}/hour`}{" "}
                    · evidenced hours: {r.hours ?? "unavailable"}
                  </p>
                )}
                {r.productivityReasons.map((x) => (
                  <p className="mt-1" key={x}>
                    {x}
                  </p>
                ))}
                <p className="mt-1 break-all text-xs">
                  Count IDs: {r.sourceIds.join(", ") || "none"} · Rule IDs:{" "}
                  {r.ruleIds.join(", ") || "none"}
                </p>
                {r.clockSourceIds.length > 0 && (
                  <p className="mt-1 break-all text-xs">Clock IDs: {r.clockSourceIds.join(", ")}</p>
                )}
              </div>
            ))}
            <p className="mt-2">Agreement / scope basis: {def.rationale}</p>
            <p className="mt-1">
              Source:{" "}
              {documents.find((d) => d.id === def.sourceDocumentId)?.name || def.sourceDocumentId} ·{" "}
              {def.sourceReference}
            </p>
            <button
              className="mt-3 rounded border px-3 py-2"
              disabled={busy}
              onClick={() => {
                setForm({ ...def, supersedesId: def.id });
                setScope(def.physicalReferences.join("\n"));
              }}
            >
              Prepare comparison revision
            </button>
          </article>
        );
      })}
      {!ctx.comparisons.length && (
        <p className="text-sm text-muted-foreground">
          No common-unit scope agreed. Individual rule results below are not yet cross-party
          comparable.
        </p>
      )}
      <details>
        <summary>Define common-unit comparison / quantity KPI</summary>
        <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
          {field("name", "Comparison name")}
          <label className="text-sm">
            Metric
            <select
              className={cl}
              value={form.metric}
              onChange={(e) => setForm({ ...form, metric: e.target.value })}
            >
              {countMetrics.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          {field("outputUnit", "Exact common output unit")}
          <label className="text-sm">
            Scope (one physical reference per line)
            <textarea
              rows={4}
              className={cl}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            />
          </label>
          <fieldset className="min-w-0 text-sm">
            <legend>Current explicit source-basis mappings</legend>
            {currentRules.map((r) => (
              <label key={r.id} className="mt-2 flex items-start gap-2 break-words">
                <input
                  className="mt-1"
                  type="checkbox"
                  checked={form.ruleIds.includes(r.id)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      ruleIds: e.target.checked
                        ? [...form.ruleIds, r.id]
                        : form.ruleIds.filter((x: string) => x !== r.id),
                    })
                  }
                />
                <span>
                  {r.name} v{r.version}: {r.inputBasis} to {r.outputUnit} · {r.acceptance}
                </span>
              </label>
            ))}
          </fieldset>
          <label className="text-sm">
            Optional evidenced duration definition
            <select
              className={cl}
              value={form.kpiDefinitionId ?? ""}
              onChange={(e) => setForm({ ...form, kpiDefinitionId: e.target.value || null })}
            >
              <option value="">No productivity calculation</option>
              {ctx.kpis
                .filter((k) => !ctx.kpis.some((x) => x.supersedes_id === k.id))
                .map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name} · {k.physical_reference} · {k.start_kind} to {k.end_kind}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-sm">
            Scope and mapping acceptance
            <select
              className={cl}
              value={form.acceptance}
              onChange={(e) => setForm({ ...form, acceptance: e.target.value })}
            >
              {["UNRESOLVED", "PARTY_REPORTED", "AGREED", "CONTRACTUALLY_SPECIFIED"].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          {field("rationale", "Agreement, physical identity, scope and limitations")}
          <label className="text-sm">
            Source document
            <select
              className={cl}
              value={form.sourceDocumentId}
              onChange={(e) => setForm({ ...form, sourceDocumentId: e.target.value })}
            >
              <option value="">Choose evidence</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          {field("sourceReference", "Page / row / source reference")}
        </div>
        <button
          className="mt-4 rounded bg-primary px-4 py-2 text-primary-foreground"
          disabled={busy}
          onClick={save}
        >
          Append comparison definition
        </button>
      </details>
    </section>
  );
}
