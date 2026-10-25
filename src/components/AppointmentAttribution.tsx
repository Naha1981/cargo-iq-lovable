import { useEffect, useState } from "react";
import {
  attributionInput,
  listAppointmentAttributions,
  addAppointmentAttribution,
} from "@/lib/appointment-attribution.functions";
import { listOperationalClocks } from "@/lib/operational-clocks.functions";
import type { Database } from "@/integrations/supabase/types";

type DocRow = Database["public"]["Tables"]["documents"]["Row"];
type AttributionRow = Database["public"]["Tables"]["appointment_attributions"]["Row"];
type ClockRow = Database["public"]["Tables"]["operational_clocks"]["Row"];
const empty = {
  appointmentClockId: "",
  claimant: "",
  claimTarget: "",
  assertion: "",
  sourceDocumentId: "",
  sourceReference: "",
  termsReference: "",
};
export function AppointmentAttribution({
  caseId,
  documents,
}: {
  caseId: string;
  documents: DocRow[];
}) {
  const [rows, setRows] = useState<AttributionRow[]>([]),
    [clocks, setClocks] = useState<ClockRow[]>([]),
    [f, setF] = useState(empty),
    [err, setErr] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([
      listAppointmentAttributions({ data: { caseId } }),
      listOperationalClocks({ data: { caseId } }),
    ])
      .then(([r, c]) => {
        if (active) {
          setRows(r);
          setClocks(c.filter((x) => x.kind.startsWith("APPOINTMENT_")));
        }
      })
      .catch((e) => {
        if (active) setErr(e.message);
      });
    return () => {
      active = false;
    };
  }, [caseId]);
  const cl = "mt-1 w-full rounded border bg-background p-2 text-sm";
  function edit(k: keyof typeof empty, v: string) {
    setF((x) => ({ ...x, [k]: v }));
  }
  async function save() {
    setBusy(true);
    setErr("");
    try {
      await addAppointmentAttribution({ data: attributionInput.parse({ ...f, caseId }) });
      setRows(await listAppointmentAttributions({ data: { caseId } }));
      setF(empty);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Attribution not saved");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-5">
      <header>
        <h2 className="text-xl font-semibold">Who issued the appointment?</h2>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Put the issuing organization, named parties and source terms beside the claim target. A
          different target is a review question, not an automatic finding of fault.
        </p>
      </header>
      {err && (
        <p role="alert" className="rounded border border-disputed p-3 text-sm">
          {err}
        </p>
      )}
      {rows.map((r) => {
        const a = clocks.find((c) => c.id === r.appointment_clock_id);
        return (
          <article key={r.id} className="rounded-lg border bg-card p-5">
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Appointment source</p>
                <h3 className="mt-2 font-semibold">
                  Issuer: {a?.appointment_issuer ?? "Source unavailable"}
                </h3>
                <p className="mt-2 text-sm">
                  {a?.appointment_reference} · {a?.timestamp_original}
                </p>
                <p className="mt-2 text-sm">Named parties: {a?.appointment_parties}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm">{a?.appointment_terms}</p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {a?.source_party} ·{" "}
                  {documents.find((d) => d.id === a?.source_document_id)?.name ??
                    a?.source_document_id}{" "}
                  · {a?.source_reference}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Claim source (party assertion)</p>
                <h3 className="mt-2 font-semibold">Target: {r.claim_target}</h3>
                <p className="mt-2 text-sm">Claimant: {r.claimant}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm">{r.assertion}</p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {documents.find((d) => d.id === r.source_document_id)?.name ??
                    r.source_document_id}{" "}
                  · {r.source_reference}
                </p>
                <p className="mt-2 text-xs">Terms reference / missing terms: {r.terms_reference}</p>
              </div>
            </div>
            <p className="mt-5 border-t pt-3 text-xs text-muted-foreground">
              No liability verdict. The issuer, claimant and target are source-attributed
              organizations, not verified responsibility or permission to contact them.
            </p>
          </article>
        );
      })}
      {!rows.length && (
        <p className="rounded border p-5 text-sm text-muted-foreground">
          No appointment-to-claim attribution recorded. Add appointment clock evidence first, then
          link the claim source.
        </p>
      )}
      <details className="rounded-lg border bg-card p-5">
        <summary className="cursor-pointer text-sm font-semibold">
          Link a claim assertion to appointment evidence
        </summary>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-sm md:col-span-2">
            Appointment source event
            <select
              className={cl}
              value={f.appointmentClockId}
              onChange={(e) => edit("appointmentClockId", e.target.value)}
            >
              <option value="">Select recorded appointment</option>
              {clocks.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.appointment_reference} · {c.appointment_issuer} · {c.timestamp_original}
                </option>
              ))}
            </select>
          </label>
          {[
            ["claimant", "Claimant organization"],
            ["claimTarget", "Claim target organization"],
            ["sourceReference", "Claim page / row / section"],
            ["termsReference", "Terms reference or explicit missing terms"],
          ].map(([k, l]) => (
            <label key={k} className="text-sm">
              {l}
              <input
                className={cl}
                value={f[k as keyof typeof empty]}
                onChange={(e) => edit(k as keyof typeof empty, e.target.value)}
              />
            </label>
          ))}
          <label className="text-sm md:col-span-2">
            Claim source document
            <select
              className={cl}
              value={f.sourceDocumentId}
              onChange={(e) => edit("sourceDocumentId", e.target.value)}
            >
              <option value="">Select case source</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm md:col-span-2">
            Source claim assertion
            <textarea
              className={cl}
              value={f.assertion}
              onChange={(e) => edit("assertion", e.target.value)}
              maxLength={4000}
            />
          </label>
        </div>
        <button
          type="button"
          disabled={busy || !clocks.length}
          onClick={save}
          className="mt-4 rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Saving..." : "Record source attribution"}
        </button>
      </details>
    </section>
  );
}
