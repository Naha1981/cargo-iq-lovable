import { useEffect, useState } from "react";
import { listKpiDefinitions, addKpiDefinition } from "@/lib/kpi-definitions.functions";
import { evaluateKpi, kpiInput } from "@/lib/kpi-definitions";
import {
  listOperationalClocks,
  listClockReconciliations,
} from "@/lib/operational-clocks.functions";
import { clockKinds } from "@/lib/operational-clocks";
const blank = {
  party: "",
  name: "",
  physicalReference: "",
  startKind: "FIRST_BOX_OFF",
  endKind: "LAST_BOX_ON",
  definition: "",
  sourceDocumentId: "",
  sourceReference: "",
  acceptance: "UNRESOLVED",
  benchmarkHours: "",
  benchmarkBasis: "",
  supersedesId: null as string | null,
};
export function KpiDefinitionRegister({ caseId, documents }: { caseId: string; documents: any[] }) {
  const [decisions, setDecisions] = useState<any[]>([]);
  const [rows, setRows] = useState<any[]>([]),
    [clocks, setClocks] = useState<any[]>([]),
    [f, setF] = useState(blank),
    [err, setErr] = useState(""),
    [busy, setBusy] = useState(false),
    [history, setHistory] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([
      listKpiDefinitions({ data: { caseId } }),
      listOperationalClocks({ data: { caseId } }),
      listClockReconciliations({ data: { caseId } }),
    ])
      .then(([r, c, d]) => {
        if (active) {
          setRows(r);
          setClocks(c);
          setDecisions(d);
        }
      })
      .catch((e) => {
        if (active) setErr(e.message);
      });
    return () => {
      active = false;
    };
  }, [caseId]);
  function edit(k: keyof typeof blank, v: string) {
    setF((x) => ({ ...x, [k]: v }));
  }
  async function save() {
    setBusy(true);
    setErr("");
    try {
      const data = kpiInput.parse({
        ...f,
        caseId,
        benchmarkHours: f.benchmarkHours === "" ? null : Number(f.benchmarkHours),
      });
      await addKpiDefinition({ data });
      setRows(await listKpiDefinitions({ data: { caseId } }));
      setF(blank);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "KPI was not saved");
    } finally {
      setBusy(false);
    }
  }
  function revise(r: any) {
    setF({
      party: r.party,
      name: r.name,
      physicalReference: r.physical_reference,
      startKind: r.start_kind,
      endKind: r.end_kind,
      definition: r.definition,
      sourceDocumentId: r.source_document_id,
      sourceReference: r.source_reference,
      acceptance: r.acceptance,
      benchmarkHours: r.benchmark_hours === null ? "" : String(r.benchmark_hours),
      benchmarkBasis: r.benchmark_basis,
      supersedesId: r.id,
    });
  }
  const latest = new Map<string, any>();
  for (const r of rows) {
    const k = JSON.stringify([
      r.party.toLowerCase().trim(),
      r.name.toLowerCase().trim(),
      r.physical_reference,
    ]);
    if (!latest.has(k) || latest.get(k).version < r.version) latest.set(k, r);
  }
  const shown = history ? rows : [...latest.values()],
    cl = "mt-1 w-full rounded border bg-background p-2 text-sm";
  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-xl font-semibold">Agree the KPI before comparing it</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Each organization's definition, start/end events and vessel or visit scope remain
          separate. A reference line comes only from that record's agreed or contractually specified
          benchmark. There is no universal 18-hour target.
        </p>
      </header>
      {err && (
        <p role="alert" className="rounded border border-disputed p-3 text-sm">
          {err}
        </p>
      )}
      <label className="flex gap-2 text-sm">
        <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
        Show all versions
      </label>
      <div className="grid gap-5 lg:grid-cols-2">
        {shown.map((r) => {
          const v = evaluateKpi(r, clocks, decisions),
            max = Math.max(v.hours ?? 0, v.referenceHours ?? 0, 1) * 1.15;
          return (
            <article key={r.id} className="min-w-0 rounded-lg border bg-card p-5">
              <p className="font-mono text-xs text-muted-foreground">
                {r.party} · v{r.version} · {r.acceptance}
              </p>
              <h3 className="mt-2 text-lg font-semibold">{r.name}</h3>
              <p className="mt-2 text-sm">Scope: {r.physical_reference}</p>
              <p className="mt-2 whitespace-pre-wrap text-sm">{r.definition}</p>
              <p className="mt-3 font-mono text-xs">
                {r.start_kind} to {r.end_kind}
              </p>
              <p className="mt-3 text-xl">
                {v.status === "DERIVED"
                  ? `${v.hours} hours (derived)`
                  : `${v.status} - result withheld`}
              </p>
              {v.hours !== null && (
                <div className="mt-4">
                  <div
                    className="relative h-8 rounded bg-secondary"
                    aria-label={`Derived ${v.hours} hours; ${v.referenceHours === null ? "no agreed benchmark" : `agreed reference ${v.referenceHours} hours`}`}
                  >
                    <div
                      className="absolute inset-y-1 left-0 rounded bg-primary/70"
                      style={{ width: `${(v.hours / max) * 100}%` }}
                    />
                    {v.referenceHours !== null && (
                      <span
                        className="absolute bottom-0 top-0 border-l-2 border-reported"
                        style={{ left: `${(v.referenceHours / max) * 100}%` }}
                      />
                    )}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Filled bar: derived hours.{" "}
                    {v.referenceHours === null
                      ? "No agreed benchmark line."
                      : `Reference line: ${v.referenceHours} hours under this record's agreement.`}
                  </p>
                </div>
              )}
              <p className="mt-3 text-xs">Benchmark basis: {r.benchmark_basis}</p>
              {!["AGREED", "CONTRACTUALLY_SPECIFIED"].includes(r.acceptance) &&
                r.benchmark_hours !== null && (
                  <p className="mt-2 text-xs">
                    Party-reported/unresolved benchmark ({r.benchmark_hours}h) is not drawn as an
                    agreed reference.
                  </p>
                )}
              <p className="mt-3 break-words text-xs text-muted-foreground">
                Definition source:{" "}
                {documents.find((d) => d.id === r.source_document_id)?.name ?? r.source_document_id}{" "}
                · {r.source_reference}
              </p>
              <p className="mt-2 break-words text-xs text-muted-foreground">
                Clock record IDs (source reconciliation, if any, is recorded in Clocks):{" "}
                {v.sourceIds.join(", ") || "Missing"}
              </p>
              <button
                type="button"
                className="mt-4 rounded border px-3 py-2 text-xs"
                onClick={() => revise(r)}
              >
                Prepare new version
              </button>
            </article>
          );
        })}
      </div>
      {!shown.length && (
        <p className="rounded border p-5 text-sm text-muted-foreground">
          No source-backed KPI definition recorded. No default benchmark is applied.
        </p>
      )}
      <details className="rounded-lg border bg-card p-5" open={!!f.supersedesId}>
        <summary className="cursor-pointer text-sm font-semibold">
          Record or version a KPI definition
        </summary>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {[
            ["party", "Source organization"],
            ["name", "KPI name"],
            ["physicalReference", "Vessel / voyage / physical reference"],
            ["sourceReference", "Agreement page / section"],
          ].map(([k, l]) => (
            <label key={k} className="text-sm">
              {l}
              <input
                className={cl}
                value={f[k as keyof typeof blank] ?? ""}
                onChange={(e) => edit(k as keyof typeof blank, e.target.value)}
                disabled={!!f.supersedesId && ["party", "name", "physicalReference"].includes(k)}
              />
            </label>
          ))}
          {[
            ["startKind", "Start event"],
            ["endKind", "End event"],
          ].map(([k, l]) => (
            <label key={k} className="text-sm">
              {l}
              <select
                className={cl}
                value={f[k as keyof typeof blank] ?? ""}
                onChange={(e) => edit(k as keyof typeof blank, e.target.value)}
              >
                {clockKinds.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          ))}
          <label className="text-sm md:col-span-2">
            KPI definition and scope
            <textarea
              className={cl}
              value={f.definition}
              onChange={(e) => edit("definition", e.target.value)}
              maxLength={4000}
            />
          </label>
          <label className="text-sm">
            Agreement / definition source
            <select
              className={cl}
              value={f.sourceDocumentId}
              onChange={(e) => edit("sourceDocumentId", e.target.value)}
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
            Acceptance
            <select
              className={cl}
              value={f.acceptance}
              onChange={(e) => edit("acceptance", e.target.value)}
            >
              {["CONTRACTUALLY_SPECIFIED", "AGREED", "PARTY_REPORTED", "UNRESOLVED"].map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Benchmark hours (optional, never defaulted)
            <input
              type="number"
              min="0"
              max="100000"
              step="any"
              className={cl}
              value={f.benchmarkHours}
              onChange={(e) => edit("benchmarkHours", e.target.value)}
            />
          </label>
          <label className="text-sm md:col-span-2">
            Benchmark agreement basis / unknowns
            <textarea
              className={cl}
              value={f.benchmarkBasis}
              onChange={(e) => edit("benchmarkBasis", e.target.value)}
              maxLength={4000}
            />
          </label>
        </div>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Saving..." : "Append KPI version"}
          </button>
          <button
            type="button"
            onClick={() => setF(blank)}
            className="rounded border px-4 py-2 text-sm"
          >
            Clear draft
          </button>
        </div>
      </details>
    </section>
  );
}
