import { CountComparisons } from "./CountComparisons";
import { useEffect, useState } from "react";
import { appendCountRecord, appendCountRule, listCountLedger } from "@/lib/count-ledger.functions";
import {
  countBases,
  countMetrics,
  countRecordInput,
  countRuleInput,
  latestCountVersions,
  reconcileCounts,
  type CountRecord,
  type CountRule,
} from "@/lib/count-ledger";
const cl = "mt-1 w-full min-w-0 rounded border bg-background p-2 text-sm";
export function CountingLedger({ caseId, documents }: { caseId: string; documents: any[] }) {
  const [data, setData] = useState<{ records: CountRecord[]; rules: CountRule[] }>({
    records: [],
    rules: [],
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(false);
  const blankRecord = {
    caseId,
    physicalReference: "",
    party: "",
    metric: "HATCH_COVER" as const,
    basis: "INDIVIDUAL_LIFT" as const,
    quantity: 0,
    occurredAt: "",
    containers20: null as number | null,
    containers40: null as number | null,
    gateKind: "NOT_APPLICABLE" as const,
    sourceDocumentId: "",
    sourceReference: "",
    limitations: "",
    supersedesId: null as string | null,
  };
  const blankRule = {
    caseId,
    name: "",
    metric: "HATCH_COVER" as const,
    inputBasis: "INDIVIDUAL_LIFT" as const,
    outputUnit: "",
    calculation: "AS_REPORTED" as const,
    numerator: 1,
    denominator: 1,
    gateKinds: [] as CountRule["gateKinds"],
    acceptance: "UNRESOLVED" as const,
    effectiveFrom: "",
    effectiveTo: null as string | null,
    sourceDocumentId: "",
    sourceReference: "",
    rationale: "",
    supersedesId: null as string | null,
  };
  const [record, setRecord] = useState<any>(blankRecord);
  const [rule, setRule] = useState<any>(blankRule);
  async function load() {
    try {
      setData(await listCountLedger({ data: { caseId } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    void load();
  }, [caseId]);
  async function save(kind: "record" | "rule") {
    setBusy(true);
    setError("");
    try {
      if (kind === "record") {
        await appendCountRecord({ data: countRecordInput.parse(record) });
        setRecord(blankRecord);
      } else {
        await appendCountRule({ data: countRuleInput.parse(rule) });
        setRule(blankRule);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  function field(form: any, set: (v: any) => void, key: string, label: string, type = "text") {
    return (
      <label className="min-w-0 text-sm" key={key}>
        {label}
        <input
          type={type}
          className={cl}
          value={form[key] ?? ""}
          onChange={(e) =>
            set({
              ...form,
              [key]:
                type === "number"
                  ? e.target.value === ""
                    ? null
                    : Number(e.target.value)
                  : e.target.value,
            })
          }
        />
      </label>
    );
  }
  function select(
    form: any,
    set: (v: any) => void,
    key: string,
    label: string,
    values: readonly string[],
  ) {
    return (
      <label className="text-sm" key={key}>
        {label}
        <select
          className={cl}
          value={form[key]}
          onChange={(e) => set({ ...form, [key]: e.target.value })}
        >
          {values.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </label>
    );
  }
  function evidence(form: any, set: (v: any) => void) {
    return (
      <>
        <label className="text-sm">
          Case source document
          <select
            className={cl}
            value={form.sourceDocumentId}
            onChange={(e) =>
              set({
                ...form,
                sourceDocumentId: e.target.value,
                ...("party" in form
                  ? { party: documents.find((d) => d.id === e.target.value)?.source_party || "" }
                  : {}),
              })
            }
          >
            <option value="">Choose evidence</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.source_party || "source unknown"})
              </option>
            ))}
          </select>
        </label>
        {field(form, set, "sourceReference", "Page / row / source reference")}
      </>
    );
  }
  const records = history ? data.records : latestCountVersions(data.records);
  const rules = latestCountVersions(data.rules);
  return (
    <div className="min-w-0 space-y-5">
      <header>
        <h2 className="text-xl font-semibold">Reconcile counts under explicit local rules</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Raw counts stay unchanged. Each organization is calculated separately. No default says one
          hatch lift equals four moves, two boxes equal two trucks, or virtual gates equal physical
          gates. Only an agreed or contractually specified, source-backed rule produces a comparable
          result. Human event identity and rule acceptance still need evidence.
        </p>
      </header>
      {error && (
        <p role="alert" className="break-words rounded border border-disputed p-3 text-sm">
          {error}
        </p>
      )}
      <CountComparisons
        caseId={caseId}
        documents={documents}
        records={data.records}
        rules={data.rules}
      />
      <label className="flex gap-2 text-sm">
        <input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} />
        Show immutable source history
      </label>
      <section className="space-y-3 rounded border p-4">
        <h3>Source counts</h3>
        {!records.length && (
          <p className="text-sm text-muted-foreground">
            No source counts recorded. Missing counts do not mean zero activity.
          </p>
        )}
        {records.map((r) => (
          <article className="min-w-0 rounded border p-3 text-sm" key={r.id}>
            <p>
              {r.party} · {r.physicalReference} · v{r.version}
            </p>
            <p className="mt-1">
              {r.quantity} {r.basis} · {r.metric} · {r.gateKind}
            </p>
            <p className="mt-1">
              20ft: {r.containers20 ?? "unknown"}; 40ft: {r.containers40 ?? "unknown"};{" "}
              {r.occurredAt}
            </p>
            <p className="mt-1 break-words">
              Source:{" "}
              {documents.find((d) => d.id === r.sourceDocumentId)?.name || r.sourceDocumentId} ·{" "}
              {r.sourceReference}
            </p>
            <p className="mt-1">{r.limitations}</p>
            <button
              className="mt-2 rounded border px-3 py-2"
              disabled={busy}
              onClick={() => setRecord({ ...r, supersedesId: r.id })}
            >
              Prepare correction
            </button>
          </article>
        ))}
      </section>
      <section className="space-y-3">
        <h3>Rule calculations</h3>
        {!rules.length && (
          <p className="text-sm text-muted-foreground">
            No executable local rule recorded. No conversion assumed.
          </p>
        )}
        {rules.map((r) => (
          <article key={r.id} className="min-w-0 rounded border p-4">
            <h4>
              {r.name} · v{r.version} · {r.acceptance}
            </h4>
            <p className="mt-2 text-sm">
              {r.inputBasis} → {r.outputUnit}: {r.calculation}
              {r.calculation === "EXPLICIT_FACTOR" ? ` × ${r.numerator}/${r.denominator}` : ""}
            </p>
            <p className="mt-1 text-xs">
              Effective {r.effectiveFrom} to {r.effectiveTo || "open ended"}; eligible gates:{" "}
              {r.gateKinds.join(", ") || "not applicable"}
            </p>
            <p className="mt-2 text-sm">{r.rationale}</p>
            <p className="mt-1 break-words text-xs">
              Rule evidence:{" "}
              {documents.find((d) => d.id === r.sourceDocumentId)?.name || r.sourceDocumentId} ·{" "}
              {r.sourceReference}
            </p>
            {reconcileCounts(data.records, r).map((result) => (
              <div key={result.party} className="mt-3 rounded bg-secondary p-3 text-sm">
                <p>
                  {result.party}:{" "}
                  {result.status === "DERIVED"
                    ? `${result.total} ${result.unit} (derived)`
                    : "WITHHELD"}
                </p>
                {result.reasons.map((reason) => (
                  <p key={reason} className="mt-1 text-xs">
                    {reason}
                  </p>
                ))}
                <p className="mt-1 break-all text-xs">
                  Record IDs: {result.sourceIds.join(", ") || "none"}
                </p>
              </div>
            ))}
            <button
              className="mt-3 rounded border px-3 py-2 text-sm"
              disabled={busy}
              onClick={() => setRule({ ...r, supersedesId: r.id })}
            >
              Prepare rule revision
            </button>
          </article>
        ))}
      </section>
      <details className="rounded border p-4">
        <summary>Record a source count or correction</summary>
        <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
          {field(record, setRecord, "physicalReference", "Physical visit / hatch operation ID")}
          {field(record, setRecord, "party", "Source organization")}
          {select(record, setRecord, "metric", "Metric", countMetrics)}
          {select(record, setRecord, "basis", "Source count basis", countBases)}
          {field(record, setRecord, "quantity", "Quantity reported", "number")}
          {field(record, setRecord, "occurredAt", "Source timestamp with UTC Z or offset")}
          {field(
            record,
            setRecord,
            "containers20",
            "20ft container count (blank = unknown)",
            "number",
          )}
          {field(
            record,
            setRecord,
            "containers40",
            "40ft container count (blank = unknown)",
            "number",
          )}
          {select(record, setRecord, "gateKind", "Gate type", [
            "PHYSICAL_IN",
            "PHYSICAL_OUT",
            "VIRTUAL_IN",
            "VIRTUAL_OUT",
            "NOT_APPLICABLE",
          ])}
          {evidence(record, setRecord)}
          {field(record, setRecord, "limitations", "Identity basis / scope / limitations")}
        </div>
        <button
          disabled={busy}
          onClick={() => save("record")}
          className="mt-4 rounded bg-primary px-4 py-2 text-primary-foreground"
        >
          Append source version
        </button>
      </details>
      <details className="rounded border p-4">
        <summary>Record an executable local rule or revision</summary>
        <div className="mt-4 grid min-w-0 gap-4 md:grid-cols-2">
          {field(rule, setRule, "name", "Rule name")}
          {select(rule, setRule, "metric", "Metric", countMetrics)}
          {select(rule, setRule, "inputBasis", "Input basis", countBases)}
          {field(rule, setRule, "outputUnit", "Comparable output unit")}
          {select(rule, setRule, "calculation", "Calculation", [
            "AS_REPORTED",
            "PER_PHYSICAL_REFERENCE",
            "CONTAINERS_FROM_MANIFEST",
            "TEU_FROM_MANIFEST",
            "EXPLICIT_FACTOR",
          ])}
          {field(rule, setRule, "numerator", "Explicit factor numerator", "number")}
          {field(rule, setRule, "denominator", "Explicit factor denominator", "number")}
          {select(rule, setRule, "acceptance", "Rule acceptance", [
            "UNRESOLVED",
            "PARTY_REPORTED",
            "AGREED",
            "CONTRACTUALLY_SPECIFIED",
          ])}
          {field(rule, setRule, "effectiveFrom", "Effective from (offset required)")}
          {field(rule, setRule, "effectiveTo", "Effective to (blank = open)")}
          {evidence(rule, setRule)}
          {field(rule, setRule, "rationale", "Why this formula applies / agreement basis")}
          <fieldset className="text-sm">
            <legend>Eligible gates (explicit selection)</legend>
            {["PHYSICAL_IN", "PHYSICAL_OUT", "VIRTUAL_IN", "VIRTUAL_OUT"].map((g) => (
              <label className="mt-2 flex gap-2" key={g}>
                <input
                  type="checkbox"
                  checked={rule.gateKinds.includes(g)}
                  onChange={(e) =>
                    setRule({
                      ...rule,
                      gateKinds: e.target.checked
                        ? [...rule.gateKinds, g]
                        : rule.gateKinds.filter((x: string) => x !== g),
                    })
                  }
                />
                {g}
              </label>
            ))}
          </fieldset>
        </div>
        <button
          disabled={busy}
          onClick={() => save("rule")}
          className="mt-4 rounded bg-primary px-4 py-2 text-primary-foreground"
        >
          Append rule version
        </button>
      </details>
    </div>
  );
}
