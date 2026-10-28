import { useMemo, useState } from "react";
import { Panel, Button } from "@/components/ui-kit";
import {
  MAERSK_DURBAN_20DRY_2026_04_15 as TARIFF,
  recomputeDemurrage,
  versionInForce,
} from "@/lib/dd-tariff";
import { buildFindings, type EvidenceEntry } from "@/lib/dd-evidence";
import { checkPortalFit } from "@/lib/dd-portal-fit";
import { buildEvidencePackV0 } from "@/lib/dd-evidence-pdf";

// Delay-Evidence Dispute Pack v0: manual inputs only, one container, one tariff library.
// No CargoWise connection, no scraping, nothing is sent from here.
const KEY = {
  carrier: "Maersk",
  port: "Durban",
  equipment: "20DRY",
  chargeType: "demurrage" as const,
};
const TARIFFS = [TARIFF];

export function DdEvidencePackV0() {
  const [containerNo, setContainerNo] = useState("");
  const [discharge, setDischarge] = useState("");
  const [gateOut, setGateOut] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [amount, setAmount] = useState("");
  const [delayDays, setDelayDays] = useState(""); // comma separated YYYY-MM-DD
  const [ledger, setLedger] = useState<EvidenceEntry[]>([]);
  const [ev, setEv] = useState({ description: "", source: "", capturedAt: "", from: "", to: "" });
  const [err, setErr] = useState<string | null>(null);

  const calc = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(discharge) || !/^\d{4}-\d{2}-\d{2}$/.test(gateOut)) return null;
    try {
      const recompute = recomputeDemurrage(TARIFFS, KEY, discharge, gateOut);
      const asserted = delayDays
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const f = buildFindings({
        recompute,
        invoicedAmount: Number(amount) || 0,
        ledger,
        assertedDelayDays: asserted,
      });
      return { recompute, ...f };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [discharge, gateOut, amount, delayDays, ledger]);

  const addEvidence = () => {
    if (
      !ev.description ||
      !ev.source ||
      !/^\d{4}-\d{2}-\d{2}$/.test(ev.from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(ev.to)
    ) {
      setErr("Description, source and covered dates (YYYY-MM-DD) are required.");
      return;
    }
    setErr(null);
    setLedger([
      ...ledger,
      {
        id: "E" + (ledger.length + 1),
        kind: "other",
        description: ev.description,
        source: ev.source,
        capturedAt: ev.capturedAt || null,
        suppliedBy: "user",
        coversFrom: ev.from,
        coversTo: ev.to,
        cause: "terminal",
        // User-entered evidence starts as INFERRED. It counts only after it is marked verified.
        status: "INFERRED",
      },
    ]);
  };
  const markVerified = (id: string) =>
    setLedger(ledger.map((e) => (e.id === id ? { ...e, status: "VERIFIED" } : e)));

  const download = () => {
    if (!calc || "error" in calc) return;
    const bytes = buildEvidencePackV0({
      containerNo,
      containerType: "20DRY",
      carrier: KEY.carrier,
      port: KEY.port,
      dates: { discharge, gateOut },
      invoice: { no: invoiceNo, amount: Number(amount) || 0, currency: "ZAR" },
      tariff: versionInForce(TARIFFS, KEY, discharge),
      recompute: calc.recompute,
      findings: calc.findings,
      notes: calc.notes,
      ledger,
      portalFit: checkPortalFit(KEY.carrier, []),
      synthetic: false,
      generatedAt: new Date().toISOString().slice(0, 10),
    });
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "delay-evidence-pack-" + (containerNo || "container") + ".pdf";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Panel title="Delay-evidence dispute pack (v0, manual)">
      <p className="text-sm">
        One container, Maersk Durban 20&apos; dry tariff effective 15 Apr 2026. Days with no stated
        rate stay UNKNOWN. Nothing is sent from here.
      </p>
      <div className="grid gap-2">
        <input
          aria-label="Container no."
          placeholder="Container no."
          value={containerNo}
          onChange={(e) => setContainerNo(e.target.value)}
        />
        <input
          aria-label="Discharge date"
          placeholder="Discharge date YYYY-MM-DD"
          value={discharge}
          onChange={(e) => setDischarge(e.target.value)}
        />
        <input
          aria-label="Gate-out date"
          placeholder="Gate-out date YYYY-MM-DD"
          value={gateOut}
          onChange={(e) => setGateOut(e.target.value)}
        />
        <input
          aria-label="Invoice no."
          placeholder="Invoice no."
          value={invoiceNo}
          onChange={(e) => setInvoiceNo(e.target.value)}
        />
        <input
          aria-label="Invoice amount"
          placeholder="Invoice amount (ZAR)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <input
          aria-label="Delay days"
          placeholder="Days you say the terminal or carrier delayed (YYYY-MM-DD, comma separated)"
          value={delayDays}
          onChange={(e) => setDelayDays(e.target.value)}
        />
      </div>
      <h4 className="mt-3 font-semibold">Evidence ledger</h4>
      <div className="grid gap-2">
        <input
          aria-label="Evidence description"
          placeholder="Evidence description"
          value={ev.description}
          onChange={(e) => setEv({ ...ev, description: e.target.value })}
        />
        <input
          aria-label="Evidence source"
          placeholder="Evidence source (document name or link)"
          value={ev.source}
          onChange={(e) => setEv({ ...ev, source: e.target.value })}
        />
        <input
          aria-label="Captured at"
          placeholder="Captured at (ISO date-time)"
          value={ev.capturedAt}
          onChange={(e) => setEv({ ...ev, capturedAt: e.target.value })}
        />
        <input
          aria-label="Covers from"
          placeholder="Covers from YYYY-MM-DD"
          value={ev.from}
          onChange={(e) => setEv({ ...ev, from: e.target.value })}
        />
        <input
          aria-label="Covers to"
          placeholder="Covers to YYYY-MM-DD"
          value={ev.to}
          onChange={(e) => setEv({ ...ev, to: e.target.value })}
        />
        <Button onClick={addEvidence}>Add evidence</Button>
      </div>
      {err && <p role="alert">{err}</p>}
      <ul>
        {ledger.map((e) => (
          <li key={e.id}>
            {e.id} [{e.status}] {e.description} ({e.coversFrom} to {e.coversTo})
            {e.status !== "VERIFIED" && (
              <Button onClick={() => markVerified(e.id)}>Mark verified</Button>
            )}
          </li>
        ))}
      </ul>
      {calc && "error" in calc && <p role="alert">{calc.error}</p>}
      {calc && "recompute" in calc && (
        <div>
          <p data-testid="known-total">
            Recomputed total (known days): ZAR {calc.recompute.knownAmount.toFixed(2)}
            {calc.recompute.complete
              ? ""
              : ` (lower bound, ${calc.recompute.unknownDays} day(s) UNKNOWN)`}
          </p>
          <ul>
            {calc.findings.map((f, i) => (
              <li key={i}>
                [{f.category}]{" "}
                {f.amount == null ? "no amount counted" : "ZAR " + f.amount.toFixed(2)}
              </li>
            ))}
          </ul>
          <Button onClick={download}>Download 2-page pack (PDF)</Button>
        </div>
      )}
    </Panel>
  );
}
