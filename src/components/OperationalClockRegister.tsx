import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { clockKinds, clockInput, compareClocks } from "@/lib/operational-clocks";
import {
  listOperationalClocks,
  addOperationalClock,
  listClockReconciliations,
  reconcileOperationalClock,
} from "@/lib/operational-clocks.functions";
const empty = {
  physicalReference: "",
  kind: "QUEUE_ARRIVAL",
  timestamp: "",
  timeZone: "Africa/Johannesburg",
  sourceParty: "",
  sourceDocumentId: "",
  sourceReference: "",
  locationBasis: "",
  appointmentIssuer: "",
  appointmentReference: "",
  appointmentParties: "",
  appointmentTerms: "",
};
export function OperationalClockRegister({
  caseId,
  documents,
}: {
  caseId: string;
  documents: any[];
}) {
  const router = useRouter();
  const [decisions, setDecisions] = useState<any[]>([]),
    [selectedClock, setSelectedClock] = useState(""),
    [decisionDoc, setDecisionDoc] = useState(""),
    [decisionRef, setDecisionRef] = useState(""),
    [decisionNote, setDecisionNote] = useState("");
  const [rows, setRows] = useState<any[]>([]),
    [f, setF] = useState(empty),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([
      listOperationalClocks({ data: { caseId } }),
      listClockReconciliations({ data: { caseId } }),
    ])
      .then(([r, d]) => {
        if (active) {
          setRows(r);
          setDecisions(d);
        }
      })
      .catch((e) => {
        if (active) setError(String(e.message ?? e));
      });
    return () => {
      active = false;
    };
  }, [caseId]);
  function edit(k: keyof typeof empty, v: string) {
    setF((x) => ({ ...x, [k]: v }));
  }
  async function save() {
    setBusy(true);
    setError("");
    try {
      const data = clockInput.parse({ ...f, caseId });
      await addOperationalClock({ data });
      setRows(await listOperationalClocks({ data: { caseId } }));
      await router.invalidate();
      setF(empty);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Clock was not recorded");
    } finally {
      setBusy(false);
    }
  }
  const cl = "mt-1 w-full rounded border bg-background p-2 text-sm";
  return (
    <section className="rounded-lg border bg-card p-4 sm:p-5">
      <h2 className="text-lg font-semibold">Three clocks, kept separate</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Precinct/geofence arrival, appointment slot, and terminal gate events are different
        evidence. Every supported clock is shown; no convenient start is selected. Elapsed time
        alone does not prove delay responsibility.
      </p>
      {error && (
        <p role="alert" className="mt-3 rounded border border-disputed p-3 text-sm">
          {error}
        </p>
      )}
      {compareClocks(rows, decisions).map((g) => (
        <article key={g.reference} className="mt-4 rounded border p-4">
          <h3 className="font-semibold">Physical reference: {g.reference}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Source-group reference entered by the investigator, not independently verified event
            matching.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {g.results.map((r) => (
              <div key={r.label} className="rounded border p-3">
                <p className="text-sm">{r.label}</p>
                <p className="mt-2 font-mono text-sm">
                  {r.status === "DERIVED"
                    ? `${r.hours} ${r.hours === 1 ? "hour" : "hours"} (derived)`
                    : `${r.status} - duration withheld`}
                </p>
                <p className="mt-2 text-xs">
                  Evidenced reconciliation IDs:{" "}
                  {r.reconciliationIds.join(", ") || "None; original source instants used"}
                </p>
                <p className="mt-2 break-words text-xs text-muted-foreground">
                  Sources:{" "}
                  {r.sources.map((s) => `${s.party} / ${s.reference}`).join("; ") ||
                    "None received"}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-2">
            {g.records.map((r) => (
              <div key={r.id} className="rounded bg-secondary/40 p-3 text-sm">
                <strong>{r.kind.replaceAll("_", " ")}</strong>
                <p className="mt-1 break-words font-mono text-xs">
                  {r.timestamp_original} · timezone label {r.time_zone}
                </p>
                <p className="mt-1 text-xs">
                  {r.source_party} ·{" "}
                  {documents.find((d) => d.id === r.source_document_id)?.name ??
                    r.source_document_id}{" "}
                  · {r.source_reference}
                </p>
                <p className="mt-1 text-xs">Location / event basis: {r.location_basis}</p>
                {r.appointment_issuer && (
                  <div className="mt-2 border-t pt-2 text-xs">
                    <p>
                      Appointment {r.appointment_reference} · Issuer: {r.appointment_issuer}
                    </p>
                    <p>Parties named in source: {r.appointment_parties}</p>
                    <p className="mt-1 whitespace-pre-wrap">
                      Source terms / limitations: {r.appointment_terms}
                    </p>
                    <p className="mt-1">
                      Issuer attribution is not a finding of contractual responsibility.
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </article>
      ))}
      {!rows.length && (
        <p className="my-4 text-sm text-muted-foreground">
          No clock evidence received. This does not prove the events did not happen.
        </p>
      )}
      <details className="mt-4 rounded border p-4">
        <summary className="cursor-pointer text-sm font-semibold">
          Record a source clock event
        </summary>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            Physical visit / event reference
            <input
              className={cl}
              value={f.physicalReference}
              onChange={(e) => edit("physicalReference", e.target.value)}
              placeholder="Same reference only for the same physical visit"
            />
          </label>
          <label className="text-sm">
            Clock event
            <select className={cl} value={f.kind} onChange={(e) => edit("kind", e.target.value)}>
              {clockKinds.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Original timestamp with offset
            <input
              className={cl}
              value={f.timestamp}
              onChange={(e) => edit("timestamp", e.target.value)}
              placeholder="2026-10-14T18:00:00+02:00"
            />
          </label>
          <label className="text-sm">
            IANA source timezone
            <input
              className={cl}
              value={f.timeZone}
              onChange={(e) => edit("timeZone", e.target.value)}
              placeholder="Africa/Johannesburg"
            />
          </label>
          <label className="text-sm">
            Source organization
            <input
              className={cl}
              value={f.sourceParty}
              onChange={(e) => edit("sourceParty", e.target.value)}
            />
          </label>
          <label className="text-sm">
            Source document
            <select
              className={cl}
              value={f.sourceDocumentId}
              onChange={(e) => edit("sourceDocumentId", e.target.value)}
            >
              <option value="">Select source</option>
              {documents.map((d) => (
                <option value={d.id} key={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Page / row / event reference
            <input
              className={cl}
              value={f.sourceReference}
              onChange={(e) => edit("sourceReference", e.target.value)}
            />
          </label>
          <label className="text-sm">
            Location or clock basis
            <input
              className={cl}
              value={f.locationBasis}
              onChange={(e) => edit("locationBasis", e.target.value)}
              placeholder="Precinct boundary, geofence, TBS slot or terminal gate"
            />
          </label>
          {f.kind.startsWith("APPOINTMENT_") && (
            <>
              <label className="text-sm">
                Appointment reference
                <input
                  className={cl}
                  value={f.appointmentReference}
                  onChange={(e) => edit("appointmentReference", e.target.value)}
                />
              </label>
              <label className="text-sm">
                Issuing organization
                <input
                  className={cl}
                  value={f.appointmentIssuer}
                  onChange={(e) => edit("appointmentIssuer", e.target.value)}
                />
              </label>
              <label className="text-sm md:col-span-2">
                Parties named in the appointment
                <input
                  className={cl}
                  value={f.appointmentParties}
                  onChange={(e) => edit("appointmentParties", e.target.value)}
                />
              </label>
              <label className="text-sm md:col-span-2">
                Source terms and unknowns
                <textarea
                  className={cl}
                  value={f.appointmentTerms}
                  onChange={(e) => edit("appointmentTerms", e.target.value)}
                  placeholder="Quote or describe the supplied terms; explicitly state missing terms. No liability verdict."
                />
              </label>
            </>
          )}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="mt-4 rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Saving..." : "Append source event"}
        </button>
        <p className="mt-3 text-xs text-muted-foreground">
          Original offset and source timezone are retained. UTC conversion is used only for
          elapsed-time arithmetic. Conflicting source times block that duration, not silently
          overwrite one source. No money is calculated here.
        </p>
      </details>
      <details className="mt-5 rounded-lg border bg-card p-5">
        <summary className="cursor-pointer text-sm font-semibold">
          Reconcile a source clock with supporting evidence
        </summary>
        <p className="mt-3 text-xs text-muted-foreground">
          Do not choose a convenient delay definition. Reconcile a factual timestamp only. Every
          basis and competing source remains visible. New source records invalidate this decision
          until reviewed again. Existing contradiction flags require separate evidenced resolution.
        </p>
        <label className="mt-3 block text-sm">
          Supported source clock
          <select
            className={cl}
            value={selectedClock}
            onChange={(e) => setSelectedClock(e.target.value)}
          >
            <option value="">Select the supported timestamp</option>
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.physical_reference} · {r.kind} · {r.timestamp_original} · {r.source_party}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-sm">
          Supporting document
          <select
            className={cl}
            value={decisionDoc}
            onChange={(e) => setDecisionDoc(e.target.value)}
          >
            <option value="">Select evidence</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-sm">
          Evidence page / row / section
          <input
            className={cl}
            value={decisionRef}
            onChange={(e) => setDecisionRef(e.target.value)}
          />
        </label>
        <label className="mt-3 block text-sm">
          Why this source time is supported
          <textarea
            className={cl}
            value={decisionNote}
            onChange={(e) => setDecisionNote(e.target.value)}
            maxLength={4000}
          />
        </label>
        <button
          type="button"
          disabled={
            busy ||
            !selectedClock ||
            !decisionDoc ||
            decisionRef.trim().length < 3 ||
            decisionNote.trim().length < 10
          }
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await reconcileOperationalClock({
                data: {
                  caseId,
                  selectedClockId: selectedClock,
                  sourceDocumentId: decisionDoc,
                  sourceReference: decisionRef,
                  explanation: decisionNote,
                },
              });
              setDecisions(await listClockReconciliations({ data: { caseId } }));
              setRows(await listOperationalClocks({ data: { caseId } }));
              await router.invalidate();
              setDecisionNote("");
            } catch (e) {
              setError(e instanceof Error ? e.message : "Reconciliation failed");
            } finally {
              setBusy(false);
            }
          }}
          className="mt-4 rounded border px-4 py-2 text-sm disabled:opacity-50"
        >
          Append evidenced reconciliation
        </button>
        <div className="mt-4 space-y-3">
          {decisions.map((d) => (
            <div key={d.id} className="rounded border p-3 text-xs">
              <p>
                {d.physical_reference} · {d.kind} · decision v{d.version}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{d.explanation}</p>
              <p className="mt-1">
                Evidence:{" "}
                {documents.find((x) => x.id === d.source_document_id)?.name ?? d.source_document_id}{" "}
                · {d.source_reference}
              </p>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
