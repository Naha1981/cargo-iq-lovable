import { useState } from "react";
import { RATE_CSV_HEADER, parseRateCsv } from "@/lib/whatsapp/rate-csv";
import type { Rate } from "@/lib/whatsapp/quote-engine";
type Props = {
  rates: Rate[];
  onImport: (csv: string) => Promise<{ count: number }>;
  onSimulate: (text: string) => Promise<{ draft: string }>;
  onRevoke: (batchId: string, reason: string) => Promise<unknown>;
  onReload: () => void;
};
export function WhatsAppQuoteAdmin({ rates, onImport, onSimulate, onRevoke, onReload }: Props) {
  const [csv, setCsv] = useState(""),
    [text, setText] = useState("JHB to Durban, 10 tonnes, tautliner"),
    [preview, setPreview] = useState<Rate[] | null>(null),
    [approved, setApproved] = useState(false),
    [draft, setDraft] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [revokeBatch, setRevokeBatch] = useState(""),
    [reason, setReason] = useState("");
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="mx-auto max-w-5xl p-5 md:p-10 space-y-6">
      <header>
        <p className="text-xs tracking-widest text-muted-foreground">CARGOIQ · ADMIN</p>
        <h1 className="mt-2 text-3xl font-semibold">WhatsApp lane quotes</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Prepare approved rates and test a request. Nothing on this page sends a WhatsApp message.
        </p>
      </header>
      <section className="rounded-lg border p-4 bg-card">
        <h2 className="font-semibold">Channel OFF · Outbound not connected</h2>
        <p className="mt-2 text-sm">
          Official Cloud API foundation. Number verification, approved customer wording and a real
          round-trip test are still required. No number is connected by importing rates.
        </p>
      </section>
      {error && (
        <p role="alert" className="rounded border border-red-500 p-4 text-sm break-words">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded border p-4 text-sm">
          {notice}
        </p>
      )}
      <section className="rounded-lg border p-5 space-y-4">
        <h2 className="text-xl font-semibold">Test a quote request</h2>
        <label className="block text-sm">
          Request text
          <textarea
            className="mt-2 block w-full rounded border bg-background p-3 min-h-24"
            value={text}
            maxLength={4096}
            onChange={(e) => {
              setText(e.target.value);
              setDraft("");
            }}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          Supported city aliases: JHB, Durban/DBN, Cape Town/CPT and Pretoria/PTA. Tautliner only.
          Additional stops, dates or special-load terms require review.
        </p>
        <button
          disabled={busy || !text.trim()}
          onClick={() =>
            run(async () => {
              setDraft("");
              const r = await onSimulate(text);
              setDraft(r.draft);
            })
          }
          className="rounded bg-primary text-primary-foreground px-4 py-2 disabled:opacity-40"
        >
          Simulate without sending
        </button>
        {draft && (
          <output
            className="block whitespace-pre-wrap break-words rounded border bg-muted p-4 text-sm"
            aria-live="polite"
          >
            {draft}
          </output>
        )}
      </section>
      <section className="rounded-lg border p-5 space-y-4">
        <h2 className="text-xl font-semibold">Import approved rate CSV</h2>
        <p className="text-sm">
          Rates are append-only. Imports are atomic and overlapping active lane/weight bands are
          rejected. All prices are fixed one-way load amounts in ZAR minor units. Weight bands
          include both endpoints; validity ends are exclusive. Do not import private member rates
          unless disclosure to inbound quote customers is approved.
        </p>
        <details>
          <summary className="cursor-pointer text-sm">Required CSV columns</summary>
          <pre className="mt-2 whitespace-pre-wrap break-all text-xs">{RATE_CSV_HEADER}</pre>
        </details>
        <label className="block text-sm">
          Choose CSV file
          <input
            type="file"
            accept=".csv,text/csv"
            className="mt-2 block w-full text-sm"
            onChange={(e) => {
              const f = e.target.files?.[0];
              setPreview(null);
              setApproved(false);
              if (f) {
                if (f.size > 200000) {
                  setError("CSV_TOO_LARGE");
                  return;
                }
                void f
                  .text()
                  .then(setCsv)
                  .catch(() => setError("Could not read file"));
              }
            }}
          />
        </label>
        <label className="block text-sm">
          Or paste CSV
          <textarea
            className="mt-2 block w-full rounded border bg-background p-3 min-h-32 font-mono text-xs"
            value={csv}
            maxLength={200000}
            onChange={(e) => {
              setCsv(e.target.value);
              setPreview(null);
              setApproved(false);
            }}
          />
        </label>
        <button
          disabled={busy || !csv}
          onClick={() => {
            setError("");
            setNotice("");
            setPreview(null);
            setApproved(false);
            try {
              setPreview(parseRateCsv(csv));
            } catch (e) {
              setError(String((e as Error).message));
            }
          }}
          className="rounded border px-4 py-2 disabled:opacity-40"
        >
          Validate and preview
        </button>
        {preview && (
          <div className="rounded border p-4 space-y-3">
            <p className="text-sm">
              {preview.length} validated rate rows. Review all source terms before importing.
            </p>
            <div className="max-h-80 overflow-auto space-y-3">
              {preview.map((r, i) => (
                <article key={i} className="rounded border p-3 text-sm break-words">
                  <p>
                    {r.version}: {r.origin} to {r.destination} · {r.minKg}-{r.maxKg} kg · ZAR{" "}
                    {(r.amountMinor / 100).toFixed(2)} ({r.vatTreatment}, {r.vatBps / 100}% VAT)
                  </p>
                  <p className="mt-1">
                    {r.validFrom} to {r.validTo}
                  </p>
                  <p className="mt-1">
                    Terms: {r.terms}. Exclusions: {r.exclusions}
                  </p>
                  <p className="mt-1">Source: {r.sourceReference}</p>
                </article>
              ))}
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
              />
              I have authority to import these rates and disclose their prices and terms to inbound
              quote customers.
            </label>
            <button
              disabled={busy || !approved}
              onClick={() =>
                run(async () => {
                  const r = await onImport(csv);
                  setDraft("");
                  setNotice(`${r.count} rates imported. Channel remains OFF.`);
                  setPreview(null);
                  setCsv("");
                  setApproved(false);
                  onReload();
                })
              }
              className="rounded bg-primary text-primary-foreground px-4 py-2 disabled:opacity-40"
            >
              Import {preview.length} rates
            </button>
          </div>
        )}
      </section>
      <section className="rounded-lg border p-5">
        <h2 className="text-xl font-semibold">Stored rates</h2>
        <p className="mt-2 text-sm">{rates.length} rate rows. No rates are preloaded.</p>
        <ul className="mt-4 space-y-3">
          {rates.map((r) => (
            <li key={r.id} className="rounded border p-3 text-sm break-words">
              {r.version} · {r.origin} to {r.destination} · {r.minKg}-{r.maxKg} kg · ZAR{" "}
              {(r.amountMinor / 100).toFixed(2)} · {r.vatTreatment}
              <p className="mt-1 text-xs text-muted-foreground">
                {r.validFrom} to {r.validTo} · Source: {r.sourceReference}
              </p>
              {r.batchId && (
                <button
                  className="mt-2 rounded border px-3 py-1 text-xs"
                  onClick={() => {
                    setRevokeBatch(r.batchId!);
                    setReason("");
                  }}
                >
                  Review batch revocation
                </button>
              )}
            </li>
          ))}
        </ul>
        {revokeBatch && (
          <div className="mt-4 rounded border p-4 space-y-3">
            <p className="text-sm break-all">
              Revoke every rate in batch {revokeBatch}. Historical quotes remain unchanged.
            </p>
            <label className="block text-sm">
              Reason
              <textarea
                className="mt-2 w-full rounded border p-2 bg-background"
                value={reason}
                maxLength={2000}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button
              className="rounded border px-3 py-2 disabled:opacity-40"
              disabled={busy || reason.trim().length < 10}
              onClick={() =>
                run(async () => {
                  await onRevoke(revokeBatch, reason);
                  setRevokeBatch("");
                  setReason("");
                  setDraft("");
                  setNotice("Batch revoked for new quotes. History retained.");
                  onReload();
                })
              }
            >
              Confirm batch revocation
            </button>
            <button className="ml-3 text-sm" onClick={() => setRevokeBatch("")}>
              Cancel
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
