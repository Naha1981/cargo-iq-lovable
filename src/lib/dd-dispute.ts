// Dispute pack and letter builder. Pure text generation from analysed facts.
// Honesty rules: the contractual basis is quoted only if the user supplied the clause;
// otherwise the letter is marked NOT READY with the blocking reasons. No invented
// law, tariff or clause numbers. Nothing is sent from here.
import { type DdAnalysis, type DdFacts, type DayLine, fromDay, toDay } from "./dd-analysis";

export interface SenderInfo {
  companyName: string;
  contactName: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface TimelineEntry {
  date: string;
  event: string;
  source: string | null;
}

export interface DisputeLetter {
  party: "carrier_terminal" | "customer";
  to: string;
  subject: string;
  body: string;
  amount: number;
  days: number;
  readyToSend: boolean;
  blockers: string[];
}

export interface DisputePack {
  timeline: TimelineEntry[];
  letters: DisputeLetter[];
  recommendedResponse: string;
  evidenceIndex: { type: string; present: boolean }[];
  currency: string;
}

const money = (n: number, c: string) => c + " " + n.toFixed(2);
const long = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

export function buildTimeline(f: DdFacts, a: DdAnalysis): TimelineEntry[] {
  const t: TimelineEntry[] = [
    { date: f.dischargeDate, event: "Container " + f.containerNo + " discharged", source: null },
    {
      date: a.freeTimeExpiresOn,
      event: "Free time (" + f.freeDays + " days) expires; charges start",
      source: null,
    },
  ];
  for (const e of f.delayEvents)
    t.push({
      date: e.from,
      event:
        "Delay begins (" +
        e.cause +
        "): " +
        e.description +
        (e.to !== e.from ? " until " + e.to : ""),
      source: e.source,
    });
  t.push({ date: f.gateOutDate, event: "Container collected / gate-out", source: null });
  return t.sort((x, y) => toDay(x.date) - toDay(y.date));
}

function ranges(days: DayLine[]): string {
  if (!days.length) return "none";
  const out: string[] = [];
  let start = days[0].date;
  let prev = days[0].date;
  for (const d of days.slice(1)) {
    if (toDay(d.date) === toDay(prev) + 1) prev = d.date;
    else {
      out.push(start === prev ? long(start) : long(start) + " to " + long(prev));
      start = prev = d.date;
    }
  }
  out.push(start === prev ? long(start) : long(start) + " to " + long(prev));
  return out.join("; ");
}

export function buildDisputePack(f: DdFacts, a: DdAnalysis, sender: SenderInfo): DisputePack {
  const c = a.currency;
  const timeline = buildTimeline(f, a);
  const sig =
    "Regards,\n" +
    sender.contactName +
    "\n" +
    sender.companyName +
    (sender.contactEmail ? "\n" + sender.contactEmail : "") +
    (sender.contactPhone ? "\n" + sender.contactPhone : "");
  const letters: DisputeLetter[] = [];

  const disputed = a.dayLines.filter(
    (d) => d.classification === "disputable_with_carrier_terminal",
  );
  const wrongDaysAmount = a.overchargeAmount;
  const dupAmount = a.duplicateAmount;
  const carrierClaim =
    Math.round((disputed.reduce((s, d) => s + d.amount, 0) + wrongDaysAmount + dupAmount) * 100) /
    100;
  if (carrierClaim > 0) {
    const blockers: string[] = [];
    if (!f.contractClause)
      blockers.push(
        "Contract or tariff clause not supplied: add the clause that gives the right to a credit.",
      );
    if (disputed.length && !a.missingDocuments.every((d) => d !== "terminal_notice"))
      blockers.push("Terminal or carrier notice for the delay is missing from the case documents.");
    if (!f.documentsPresent.includes("carrier_invoice"))
      blockers.push("Carrier invoice is not attached.");
    const lines: string[] = [];
    lines.push("Dear " + f.carrier + (f.terminal ? " / " + f.terminal : "") + " accounts team,");
    lines.push("");
    lines.push(
      "Request for credit: container " +
        f.containerNo +
        ", invoice(s) " +
        f.invoices.map((i) => i.invoiceNo).join(", ") +
        ".",
    );
    lines.push("");
    lines.push("Timeline");
    for (const t of timeline)
      lines.push(
        "- " + long(t.date) + ": " + t.event + (t.source ? " (ref: " + t.source + ")" : ""),
      );
    lines.push("");
    lines.push("Basis of this request");
    if (disputed.length)
      lines.push(
        "- " +
          disputed.length +
          " chargeable day(s) (" +
          ranges(disputed) +
          ") fall inside a delay recorded in the attached notice(s). These days were not caused by the cargo owner or forwarder. Amount: " +
          money(
            disputed.reduce((s, d) => s + d.amount, 0),
            c,
          ) +
          ".",
      );
    if (wrongDaysAmount > 0)
      lines.push(
        "- The invoice charges " +
          money(a.invoicedAmount - a.duplicateAmount, c) +
          ", but free time, dates and the agreed daily rates support " +
          money(a.calculatedAmount, c) +
          ". Difference: " +
          money(wrongDaysAmount, c) +
          ".",
      );
    if (dupAmount > 0)
      lines.push(
        "- A repeated charge of " +
          money(dupAmount, c) +
          " appears on the invoices for the same container and period.",
      );
    lines.push(
      "- Contractual basis: " +
        (f.contractClause ? f.contractClause : "[ADD CLAUSE BEFORE SENDING]"),
    );
    lines.push("");
    lines.push("Credit requested: " + money(carrierClaim, c) + ".");
    lines.push(
      "Please confirm the credit note or give a written reason for declining, within 10 working days.",
    );
    lines.push("");
    lines.push(
      "Attached: " +
        (f.documentsPresent.length ? f.documentsPresent.join(", ") : "no documents recorded"),
    );
    lines.push("");
    lines.push(sig);
    letters.push({
      party: "carrier_terminal",
      to: f.carrier,
      subject:
        "Credit request: container " +
        f.containerNo +
        " - " +
        f.invoices.map((i) => i.invoiceNo).join(", "),
      body: lines.join("\n"),
      amount: carrierClaim,
      days: disputed.length,
      readyToSend: blockers.length === 0,
      blockers,
    });
  }

  const custDays = a.dayLines.filter((d) => d.classification === "recoverable_from_customer");
  if (a.customerRebillAmount > 0) {
    const blockers: string[] = [];
    if (!f.contractClause)
      blockers.push("Terms of trade clause that lets you pass on demurrage not supplied.");
    const lines = [
      "Dear customer,",
      "",
      "Demurrage rebill: container " + f.containerNo + ".",
      "",
      "Charges of " +
        money(
          custDays.reduce((s, d) => s + d.amount, 0),
          c,
        ) +
        " accrued on " +
        custDays.length +
        " day(s) (" +
        ranges(custDays) +
        ") while the delay sat with you or customs. " +
        money(f.customerBilledAmount ?? 0, c) +
        " has been billed so far.",
      "Amount now invoiced: " + money(a.customerRebillAmount, c) + ".",
      "Basis: " + (f.contractClause ? f.contractClause : "[ADD CLAUSE BEFORE SENDING]"),
      "",
      sig,
    ];
    letters.push({
      party: "customer",
      to: "Customer",
      subject: "Demurrage rebill: container " + f.containerNo,
      body: lines.join("\n"),
      amount: a.customerRebillAmount,
      days: custDays.length,
      readyToSend: blockers.length === 0,
      blockers,
    });
  }

  const parts: string[] = [];
  if (carrierClaim > 0)
    parts.push("Send the credit request to " + f.carrier + " for " + money(carrierClaim, c) + ".");
  if (a.customerRebillAmount > 0)
    parts.push(
      "Rebill the customer " + money(a.customerRebillAmount, c) + " for customer-caused days.",
    );
  const payable = a.totals.find((t) => t.classification === "correctly_payable")!;
  if (payable.days)
    parts.push(
      "Pay " +
        payable.days +
        " day(s) (" +
        money(payable.amount, c) +
        ") unless new evidence appears.",
    );
  const avoid = a.totals.find((t) => t.classification === "avoidable_next_time")!;
  if (avoid.days)
    parts.push(
      avoid.days +
        " day(s) (" +
        money(avoid.amount, c) +
        ") were in your control: fix the process.",
    );
  if (!parts.length)
    parts.push("No dispute or rebill supported by the records. Pay the invoice as calculated.");

  const present = new Set(f.documentsPresent);
  const evidenceIndex = [
    "bill_of_lading",
    "tariff_or_free_time",
    "terminal_release",
    "terminal_notice",
    "carrier_invoice",
    "customer_invoice",
    "customs_release",
  ].map((type) => ({ type, present: present.has(type as never) }));
  return { timeline, letters, recommendedResponse: parts.join(" "), evidenceIndex, currency: c };
}

export function mailtoLink(l: DisputeLetter, to = ""): string {
  return (
    "mailto:" +
    encodeURIComponent(to) +
    "?subject=" +
    encodeURIComponent(l.subject) +
    "&body=" +
    encodeURIComponent(l.body)
  );
}
export { fromDay };
