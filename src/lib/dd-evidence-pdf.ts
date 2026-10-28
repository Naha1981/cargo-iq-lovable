// Two-page "Delay-Evidence Dispute Pack v0". Manual inputs only. Nothing is sent.
import type { Finding, EvidenceEntry } from "./dd-evidence";
import type { Recompute, TariffVersion } from "./dd-tariff";
import type { PortalFit } from "./dd-portal-fit";
import { buildPdf, layout, wrapText, type PdfLine } from "./dd-pdf-lite";

export interface PackInput {
  containerNo: string;
  containerType: string;
  carrier: string;
  port: string;
  dates: { discharge: string; gateOut: string };
  invoice: { no: string; amount: number; currency: string };
  tariff: TariffVersion | null;
  recompute: Recompute;
  findings: Finding[];
  notes: string[];
  ledger: EvidenceEntry[];
  portalFit: PortalFit;
  synthetic: boolean;
  generatedAt: string;
}

const money = (n: number | null, c: string) => (n == null ? "UNKNOWN" : c + " " + n.toFixed(2));

export function packLines(p: PackInput): PdfLine[] {
  const L: PdfLine[] = [];
  const t = (text: string, o: Partial<PdfLine> = {}) =>
    wrapText(text, o.size ?? 9).forEach((x) => L.push({ text: x, ...o }));
  t("CargoIQ - Delay-Evidence Dispute Pack v0 - DRAFT", { size: 15, bold: true });
  t(
    p.synthetic
      ? "SYNTHETIC DATA. Not a real dispute."
      : "Prepared from user-entered data. Not approved for submission until a person reviews it.",
    { size: 9, bold: true },
  );
  t(
    `Generated ${p.generatedAt}. Container ${p.containerNo} (${p.containerType}), ${p.carrier}, ${p.port}.`,
  );
  t(
    `Discharge ${p.dates.discharge}, gate-out ${p.dates.gateOut}. Invoice ${p.invoice.no}: ${money(p.invoice.amount, p.invoice.currency)}.`,
  );
  L.push({ text: "", size: 6 });
  t("1. Tariff used", { size: 11, bold: true });
  if (p.tariff) {
    t(
      `${p.tariff.id}, effective ${p.tariff.effectiveFrom}${p.tariff.effectiveTo ? " to " + p.tariff.effectiveTo : ""}, free days ${p.tariff.freeDays}. Counting rule: ${p.tariff.countingRule}.`,
    );
    t("Source: " + p.tariff.source);
    if (p.tariff.note) t("Caveat: " + p.tariff.note);
  } else t("No tariff version in force on the discharge date. Nothing is recomputed.");
  L.push({ text: "", size: 6 });
  t("2. Recomputed charge by day", { size: 11, bold: true });
  for (const d of p.recompute.days)
    t(
      `${d.date}  chargeable day ${d.chargeableDay}  ${d.status === "rated" ? money(d.rate, p.invoice.currency) : "UNKNOWN (" + d.status + ")"}`,
    );
  if (!p.recompute.days.length) t("No chargeable days.");
  t(
    `Known total ${money(p.recompute.knownAmount, p.invoice.currency)}. Unknown days: ${p.recompute.unknownDays}. ${p.recompute.complete ? "Recompute is complete." : "Total is a lower bound."}`,
    { bold: true },
  );
  L.push({ text: "", size: 6 });
  t("3. Findings (operational labels, not legal conclusions)", { size: 11, bold: true });
  if (!p.findings.length) t("No finding.");
  for (const f of p.findings)
    t(
      `[${f.category}] ${f.amount == null ? "no amount counted" : money(f.amount, p.invoice.currency)}${f.days ? " days " + f.days.join(", ") : ""}${f.evidenceIds ? " evidence " + f.evidenceIds.join(", ") : ""}. ${f.note}`,
    );
  for (const n of p.notes) t("Note: " + n);
  L.push({ text: "", size: 6 });
  t("4. Evidence ledger", { size: 11, bold: true });
  if (!p.ledger.length) t("No evidence recorded.");
  for (const e of p.ledger)
    t(
      `${e.id} [${e.status}] ${e.kind}: ${e.description}. Source: ${e.source}. Captured ${e.capturedAt ?? "UNKNOWN"}. Covers ${e.coversFrom} to ${e.coversTo} (${e.cause}).`,
    );
  L.push({ text: "", size: 6 });
  t("5. Carrier portal fit", { size: 11, bold: true });
  if (p.portalFit.status === "unverified") t("Unverified: " + p.portalFit.reason);
  else
    t(
      `${p.portalFit.status.toUpperCase()}${p.portalFit.problems.length ? ": " + p.portalFit.problems.join("; ") : ""}. Source: ${p.portalFit.source}`,
    );
  L.push({ text: "", size: 6 });
  t(
    "Limits: no amount here is recovered. A recoverable claim exists only with a credit note reference. Liability for a delay is for the parties or a lawyer to decide.",
    { size: 8 },
  );
  return L;
}

export function buildEvidencePackV0(p: PackInput): Uint8Array {
  return buildPdf(layout(packLines(p), 2), "Delay-Evidence Dispute Pack v0 " + p.containerNo);
}
