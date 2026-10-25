import { useState } from "react";
import { AppHeader } from "@/components/ui-kit";
import {
  demoRecords,
  findTimestampConflicts,
  gateDurations,
  SYNTHETIC_NOTICE,
} from "@/lib/cuf-demo";

const reviews = [
  {
    title: "Hatch covers: four lifts or one operation?",
    ids: ["M01", "M02"],
    detail:
      "Both records may be correct. Four individual lifts and one grouped hatch-cover operation are different units. Container moves are a third measure. No automatic factual contradiction is claimed.",
  },
  {
    title: "One truck, two boxes",
    ids: ["T01", "T02"],
    detail:
      "One vehicle visit carried SYN-C01 and SYN-C02. Keep vehicle visits and container deliveries separate; do not invent a second truck.",
  },
  {
    title: "Outside queue versus inside-terminal time",
    ids: ["Q01", "Q02", "Q03", "C01", "C02"],
    detail:
      "06:00 queue arrival to the reported 18:00 gate-in is 12 hours; 18:00 to 20:00 gate-out is 2 hours. That split is provisional because export B puts the same gate-in at 19:00. All times are UTC.",
  },
  {
    title: "Appointment issuer versus claim target",
    ids: ["A01", "A02"],
    detail:
      "The appointment notice names Synthetic Shipping Line; the transporter's claim names Synthetic Terminal. Review the terms, duties and evidence. This difference alone does not establish liability.",
  },
  {
    title: "Competing KPI clocks",
    ids: ["K01", "K02", "K03"],
    detail:
      "Vessel-window start to last-box-on is 20 hours. First-box-off to last-box-on is 16 hours. Different definitions are not inherently contradictory. Choose the agreed metric before comparing performance.",
  },
  {
    title: "Missing processing evidence",
    ids: ["G01"],
    detail:
      "No intermediate processing events were supplied. The timeline cannot prove what happened inside this gap or who caused a delay.",
  },
];
export function CufDemo() {
  const [tab, setTab] = useState("Review");
  const [review, setReview] = useState<Record<number, string>>({});
  const [gateIn, setGateIn] = useState("");
  const conflicts = findTimestampConflicts(demoRecords);
  const blocked = conflicts.length > 0 && !gateIn;
  const durations = gateIn ? gateDurations(gateIn) : null;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <p className="inline-block rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground">
          Sample data. Fictional records; nothing here is saved.
        </p>
        <p className="mt-7 font-mono text-xs text-muted-foreground">SYN-COUNT-CLOCK-01</p>
        <h1 className="mt-2 text-3xl font-semibold">Sample counting and clock review</h1>
        <p className="mt-3 max-w-3xl text-muted-foreground">
          Follow each statement back to its source record, separate different counting bases, and
          reconcile the true timestamp conflict before calculating. No existing investigation is
          changed.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ["Source records", "15"],
            ["Open timestamp conflicts", blocked ? String(conflicts.length) : "0 (local choice)"],
            ["Semantic review topics", "6"],
            ["Financial calculation", blocked ? "BLOCKED" : "NO COST INPUTS"],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border bg-card p-4">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="mt-2 font-mono text-xl">{value}</div>
            </div>
          ))}
        </div>
        <nav aria-label="Demo views" className="my-6 flex flex-wrap gap-2">
          {["Review", "Timeline", "Sources", "Financials"].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={
                "rounded border px-4 py-2 text-sm " +
                (tab === t ? "bg-primary text-primary-foreground" : "bg-card")
              }
            >
              {t}
            </button>
          ))}
        </nav>
        {tab === "Review" && (
          <section className="space-y-4">
            <div role="alert" className="rounded-lg border border-disputed/50 bg-disputed/10 p-4">
              <h2 className="font-semibold">
                {blocked
                  ? "FLAGGED: same gate-in, conflicting times"
                  : "Gate-in reconciled for this local sample"}
              </h2>
              <p className="mt-2 text-sm">
                {conflicts[0].records.join(", ")}: same TRUCK-SYN-01 terminal_gate_in, 18:00 versus
                19:00 UTC. The deterministic sample detector groups by event and claim type and
                flags differences of at least one hour.
              </p>
              <label className="mt-3 block text-sm">
                Human reconciliation, after checking source evidence
                <select
                  className="mt-2 block w-full rounded border bg-background p-2"
                  value={gateIn}
                  onChange={(e) => setGateIn(e.target.value)}
                >
                  <option value="">Unresolved - keep calculations blocked</option>
                  <option value="2026-10-14T18:00:00Z">
                    Use 18:00 UTC (Q02 / C01), sample review choice
                  </option>
                  <option value="2026-10-14T19:00:00Z">
                    Use 19:00 UTC (C02), sample review choice
                  </option>
                </select>
              </label>
              {gateIn && (
                <p className="mt-2 text-sm">
                  Local review choice only. No source record was overwritten and no server
                  resolution was saved.
                </p>
              )}
            </div>
            {reviews.map((r, i) => (
              <article key={r.title} className="rounded-lg border bg-card p-5">
                <h2 className="text-lg font-semibold">{r.title}</h2>
                <p className="mt-2 text-sm leading-relaxed">{r.detail}</p>
                <p className="mt-3 font-mono text-xs text-muted-foreground">
                  Source records: {r.ids.join(", ")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {["Pending human review", "Verified for sample", "Disputed in sample"].map(
                    (s) => (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={(review[i] ?? "Pending human review") === s}
                        onClick={() => setReview({ ...review, [i]: s })}
                        className={
                          "rounded border px-3 py-2 text-xs " +
                          ((review[i] ?? "Pending human review") === s ? "bg-secondary" : "")
                        }
                      >
                        {s}
                      </button>
                    ),
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Review labels do not resolve the gate-in conflict or establish liability.
                </p>
              </article>
            ))}
          </section>
        )}
        {tab === "Timeline" && (
          <section>
            <h2 className="text-xl font-semibold">Source-linked timeline (UTC)</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Different claim types remain separate. The missing processing interval is not filled
              with invented events.
            </p>
            <div className="mt-4 space-y-3">
              {[...demoRecords]
                .filter((r) => r.timestamp_utc)
                .sort((a, b) => a.timestamp_utc.localeCompare(b.timestamp_utc))
                .map((r) => (
                  <article key={r.record_id} className="rounded-lg border bg-card p-4">
                    <p className="font-mono text-xs">
                      {r.timestamp_utc} · {r.record_id} · {r.claim_type}
                    </p>
                    <p className="mt-2 text-sm">{r.statement}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {r.source_party} · {r.event_reference}
                    </p>
                  </article>
                ))}
            </div>
          </section>
        )}
        {tab === "Sources" && (
          <section>
            <h2 className="text-xl font-semibold">15 fictional source records</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              These are preloaded fixture statements, not independently verified evidence or
              AI-extracted documents.
            </p>
            <div className="mt-4 space-y-3">
              {demoRecords.map((r) => (
                <article key={r.record_id} className="rounded-lg border bg-card p-4">
                  <h3 className="font-semibold">
                    {r.record_id} · {r.source_party}
                  </h3>
                  <p className="mt-2 font-mono text-xs">
                    {r.event_reference} · {r.quantity && `${r.quantity} `}
                    {r.counting_basis}
                  </p>
                  <p className="mt-2 text-sm">{r.statement}</p>
                </article>
              ))}
            </div>
          </section>
        )}
        {tab === "Financials" && (
          <section className="rounded-lg border bg-card p-5">
            <h2 className="text-xl font-semibold">
              {blocked
                ? "BLOCKED - reconcile the gate-in contradiction first"
                : "Clock comparison available; money is not calculable"}
            </h2>
            {blocked ? (
              <p className="mt-3 text-sm">
                No duration-based monetary figure is shown while the timestamp is unresolved. The
                reported 12-hour outside / 2-hour inside split is provisional. Reconcile it in
                Review.
              </p>
            ) : (
              <p className="mt-3 text-sm">
                Selected gate-in gives {durations?.outside} hours outside and {durations?.inside}{" "}
                hours inside. This derived interval uses a local human choice, not a confirmed fact.
              </p>
            )}
            <p className="mt-4 text-sm">
              No charged amount, applicable tariff, free-time terms, currency agreement or liability
              evidence has been supplied. No recovery amount can be claimed, even after the
              timestamp is reconciled.
            </p>
            <button
              type="button"
              disabled
              className="mt-4 rounded bg-secondary px-4 py-2 text-sm opacity-60"
            >
              {blocked ? "Calculation blocked" : "Missing commercial inputs"}
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
