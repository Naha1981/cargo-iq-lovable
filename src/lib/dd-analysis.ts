// Managed demurrage & detention (D&D) dispute engine: deterministic analysis.
// Takes case facts (each with a source) and returns auto-flagged exceptions and a
// per-day classification: recoverable from customer, disputable with carrier or
// terminal, avoidable next time, or correctly payable. No AI, no guessing: a day is
// only classed "disputable" when a recorded delay event with a cause and a source
// covers it. Amounts are exposure, never "recovered" (see dd-followup.ts).
import { z } from "zod";

export const DELAY_CAUSES = [
  "terminal",
  "carrier",
  "customs",
  "customer",
  "forwarder",
  "weather",
  "other",
] as const;
export type DelayCause = (typeof DELAY_CAUSES)[number];

export const CLASSIFICATIONS = [
  "disputable_with_carrier_terminal",
  "recoverable_from_customer",
  "avoidable_next_time",
  "correctly_payable",
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const delayEvent = z.object({
  from: isoDate,
  to: isoDate, // inclusive last day affected
  cause: z.enum(DELAY_CAUSES),
  description: z.string().trim().min(1).max(500),
  source: z.string().trim().min(1).max(300), // document name or reference
});
export type DelayEvent = z.infer<typeof delayEvent>;

export const invoiceRecord = z.object({
  invoiceNo: z.string().trim().min(1).max(80),
  chargeType: z.enum(["demurrage", "detention", "storage", "other"]).default("demurrage"),
  periodFrom: isoDate.optional(),
  periodTo: isoDate.optional(),
  days: z.number().int().nonnegative().optional(),
  amount: z.number().finite().nonnegative(),
});
export type InvoiceRecord = z.infer<typeof invoiceRecord>;

export const rateTier = z.object({
  fromDay: z.number().int().positive(),
  toDay: z.number().int().positive().optional(),
  dailyRate: z.number().finite().nonnegative(),
});

export const DOC_TYPES = [
  "bill_of_lading",
  "carrier_notice",
  "tariff_or_free_time",
  "terminal_release",
  "terminal_notice",
  "carrier_invoice",
  "customer_invoice",
  "customs_release",
  "other",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const ddFacts = z.object({
  containerNo: z.string().trim().min(4).max(20),
  carrier: z.string().trim().min(1).max(120),
  terminal: z.string().trim().max(120).default(""),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .default("ZAR"),
  dischargeDate: isoDate,
  freeDays: z.number().int().nonnegative().max(365),
  gateOutDate: isoDate,
  units: z.number().int().positive().max(100).default(1),
  rateTiers: z.array(rateTier).min(1),
  invoices: z.array(invoiceRecord).min(1).max(50),
  delayEvents: z.array(delayEvent).max(50).default([]),
  // null = customer invoice not supplied (unknown), 0 = confirmed not billed.
  customerBilledAmount: z.number().finite().nonnegative().nullable().default(null),
  contractClause: z.string().trim().max(2000).optional(),
  documentsPresent: z.array(z.enum(DOC_TYPES)).default([]),
});
export type DdFacts = z.infer<typeof ddFacts>;

export interface DayLine {
  date: string;
  dayNumber: number; // 1-based day counted from discharge
  chargeableDay: number; // 1-based chargeable day
  rate: number;
  amount: number;
  classification: Classification;
  cause: DelayCause | null;
  reason: string;
  source: string | null;
}

export interface Exception {
  code:
    | "wrong_days"
    | "duplicate_charge"
    | "terminal_or_carrier_caused"
    | "not_billed_to_customer"
    | "missing_documents"
    | "free_time_expired";
  message: string;
  amount: number | null;
}

export interface ClassTotal {
  classification: Classification;
  days: number;
  amount: number;
}

export interface DdAnalysis {
  freeTimeExpiresOn: string; // date free time runs out: first chargeable day
  elapsedDays: number;
  chargeableDays: number;
  calculatedAmount: number;
  invoicedAmount: number;
  invoicedDays: number | null;
  overchargeAmount: number; // invoiced minus calculated, only if positive
  duplicateAmount: number;
  dayLines: DayLine[];
  totals: ClassTotal[];
  exceptions: Exception[];
  missingDocuments: DocType[];
  customerRebillAmount: number; // amount not yet passed to the customer that the customer owes
  fallbackRebillAmount: number; // all calculated charges not yet billed on: only if a carrier credit is declined and terms of trade allow
  currency: string;
}

const DAY = 86400000;
const r2 = (n: number) => Math.round(n * 100) / 100;
export const toDay = (iso: string): number => {
  const t = Date.parse(iso + "T00:00:00Z");
  if (!Number.isFinite(t)) throw new Error("INVALID_DATE: " + iso);
  return Math.floor(t / DAY);
};
export const fromDay = (d: number): string => new Date(d * DAY).toISOString().slice(0, 10);

export function rateForDay(tiers: z.infer<typeof rateTier>[], chargeableDay: number): number {
  const tier =
    tiers.find(
      (t) => chargeableDay >= t.fromDay && (t.toDay == null || chargeableDay <= t.toDay),
    ) ?? tiers[tiers.length - 1];
  if (!tier) throw new Error("NO_RATE_RULE");
  return tier.dailyRate;
}

const CAUSE_TO_CLASS: Record<DelayCause, [Classification, string]> = {
  terminal: ["disputable_with_carrier_terminal", "Delay caused by the terminal"],
  carrier: ["disputable_with_carrier_terminal", "Delay caused by the carrier"],
  customs: [
    "recoverable_from_customer",
    "Customs hold sits with the cargo owner, so it is passed on to the customer",
  ],
  customer: [
    "recoverable_from_customer",
    "Delay caused by the customer (documents, payment or collection)",
  ],
  forwarder: ["avoidable_next_time", "Delay within the forwarder's own control"],
  weather: [
    "correctly_payable",
    "Weather or force majeure: payable unless the contract excuses it",
  ],
  other: ["correctly_payable", "Recorded cause does not shift the charge"],
};

// Precedence when events overlap on one day: carrier/terminal fault beats customer fault
// beats forwarder fault beats neutral. Documented so the outcome is explainable.
const PRECEDENCE: DelayCause[] = [
  "terminal",
  "carrier",
  "customer",
  "customs",
  "forwarder",
  "weather",
  "other",
];

export function requiredDocuments(facts: DdFacts): DocType[] {
  const req: DocType[] = [
    "bill_of_lading",
    "tariff_or_free_time",
    "terminal_release",
    "carrier_invoice",
  ];
  if (facts.delayEvents.some((e) => e.cause === "terminal" || e.cause === "carrier"))
    req.push("terminal_notice");
  if (facts.delayEvents.some((e) => e.cause === "customs")) req.push("customs_release");
  if (facts.customerBilledAmount !== null) req.push("customer_invoice");
  return req;
}

export function analyseDd(input: DdFacts): DdAnalysis {
  const f = ddFacts.parse(input);
  const discharge = toDay(f.dischargeDate);
  const gateOut = toDay(f.gateOutDate);
  if (gateOut < discharge) throw new Error("GATE_OUT_BEFORE_DISCHARGE");
  const elapsed = gateOut - discharge; // same whole-day rule as calculateDemurrage
  const chargeableDays = Math.max(0, elapsed - f.freeDays);
  const firstChargeable = discharge + f.freeDays; // day index 0 = discharge date
  const dayLines: DayLine[] = [];
  for (let n = 1; n <= chargeableDays; n++) {
    const date = firstChargeable + n - 1;
    const rate = r2(rateForDay(f.rateTiers, n) * f.units);
    const covering = f.delayEvents.filter((e) => toDay(e.from) <= date && date <= toDay(e.to));
    let cause: DelayCause | null = null;
    let source: string | null = null;
    for (const c of PRECEDENCE) {
      const hit = covering.find((e) => e.cause === c);
      if (hit) {
        cause = c;
        source = hit.source;
        break;
      }
    }
    const [classification, reason] = cause
      ? CAUSE_TO_CLASS[cause]
      : (["correctly_payable", "No recorded delay event covers this day"] as [
          Classification,
          string,
        ]);
    dayLines.push({
      date: fromDay(date),
      dayNumber: date - discharge + 1,
      chargeableDay: n,
      rate,
      amount: rate,
      classification,
      cause,
      reason,
      source,
    });
  }
  const calculatedAmount = r2(dayLines.reduce((s, d) => s + d.amount, 0));
  const invoicedAmount = r2(f.invoices.reduce((s, i) => s + i.amount, 0));

  // Duplicates: same charge type with an overlapping period, or identical invoice number
  // and amount repeated. The later occurrence is the duplicate.
  let duplicateAmount = 0;
  const seen: InvoiceRecord[] = [];
  const effective: InvoiceRecord[] = [];
  const exceptions: Exception[] = [];
  for (const inv of f.invoices) {
    const dup = seen.find(
      (s) =>
        (s.invoiceNo === inv.invoiceNo && s.amount === inv.amount) ||
        (s.chargeType === inv.chargeType &&
          s.periodFrom &&
          s.periodTo &&
          inv.periodFrom &&
          inv.periodTo &&
          toDay(inv.periodFrom) <= toDay(s.periodTo) &&
          toDay(s.periodFrom) <= toDay(inv.periodTo)),
    );
    if (dup) {
      duplicateAmount = r2(duplicateAmount + inv.amount);
      exceptions.push({
        code: "duplicate_charge",
        message:
          "Invoice " +
          inv.invoiceNo +
          " repeats " +
          dup.invoiceNo +
          (dup.invoiceNo === inv.invoiceNo ? " (same number and amount)" : " (overlapping period)"),
        amount: inv.amount,
      });
    } else effective.push(inv);
    seen.push(inv);
  }
  const effectiveAmount = r2(effective.reduce((s, i) => s + i.amount, 0));
  const invoicedDaysList = effective.map((i) => i.days).filter((d): d is number => d != null);
  const invoicedDays =
    invoicedDaysList.length === effective.length && effective.length
      ? invoicedDaysList.reduce((a, b) => a + b, 0)
      : null;
  const overchargeAmount = Math.max(0, r2(effectiveAmount - calculatedAmount));

  if (f.freeDays + 1 <= elapsed)
    exceptions.push({
      code: "free_time_expired",
      message:
        "Free time expired on " +
        fromDay(firstChargeable) +
        "; container left on " +
        f.gateOutDate +
        " after " +
        elapsed +
        " elapsed days (" +
        chargeableDays +
        " chargeable).",
      amount: null,
    });
  if (invoicedDays != null && invoicedDays !== chargeableDays)
    exceptions.push({
      code: "wrong_days",
      message:
        "Invoiced " +
        invoicedDays +
        " days; records support " +
        chargeableDays +
        " chargeable days.",
      amount: invoicedDays > chargeableDays ? overchargeAmount : null,
    });
  else if (invoicedDays == null && overchargeAmount > 0)
    exceptions.push({
      code: "wrong_days",
      message:
        "Invoiced amount " +
        effectiveAmount.toFixed(2) +
        " exceeds the " +
        calculatedAmount.toFixed(2) +
        " supported by free time, dates and the rate tiers.",
      amount: overchargeAmount,
    });

  const totals: ClassTotal[] = CLASSIFICATIONS.map((c) => {
    const ls = dayLines.filter((d) => d.classification === c);
    return { classification: c, days: ls.length, amount: r2(ls.reduce((s, d) => s + d.amount, 0)) };
  });
  const tc = totals.find((t) => t.classification === "disputable_with_carrier_terminal")!;
  if (tc.days)
    exceptions.push({
      code: "terminal_or_carrier_caused",
      message: tc.days + " chargeable day(s) fall inside a recorded terminal or carrier delay.",
      amount: tc.amount,
    });

  // Customer rebill: the customer-owed share (customer + customs days) less anything
  // already billed. Unknown billing (null) is reported as unknown, never as zero.
  const customerOwed = totals.find((t) => t.classification === "recoverable_from_customer")!.amount;
  let customerRebillAmount = 0;
  if (f.customerBilledAmount === null) {
    if (customerOwed > 0)
      exceptions.push({
        code: "not_billed_to_customer",
        message:
          "Customer invoice not supplied: cannot confirm whether the " +
          customerOwed.toFixed(2) +
          " customer-owed charges were billed on.",
        amount: null,
      });
  } else {
    // Everything the forwarder pays and the customer owes: payable days are only passed on
    // if the contract says so, so rebill is limited to customer-caused days.
    customerRebillAmount = Math.max(0, r2(customerOwed - f.customerBilledAmount));
    if (customerRebillAmount > 0)
      exceptions.push({
        code: "not_billed_to_customer",
        message:
          "Customer-caused charges of " +
          customerOwed.toFixed(2) +
          " vs " +
          f.customerBilledAmount.toFixed(2) +
          " billed: " +
          customerRebillAmount.toFixed(2) +
          " not passed on.",
        amount: customerRebillAmount,
      });
  }

  let fallbackRebillAmount = 0;
  if (f.customerBilledAmount !== null) {
    fallbackRebillAmount = Math.max(0, r2(calculatedAmount - f.customerBilledAmount));
    const dis = totals.find((t) => t.classification === "disputable_with_carrier_terminal")!.amount;
    if (fallbackRebillAmount > 0 && fallbackRebillAmount > customerRebillAmount)
      exceptions.push({
        code: "not_billed_to_customer",
        message:
          "Customer was billed " +
          f.customerBilledAmount.toFixed(2) +
          " against " +
          calculatedAmount.toFixed(2) +
          " of calculated charges. " +
          (dis > 0 ? "Pursue the carrier credit first; " : "") +
          "up to " +
          fallbackRebillAmount.toFixed(2) +
          " may be rebillable if the terms of trade allow.",
        amount: fallbackRebillAmount,
      });
  }

  const required = requiredDocuments(f);
  const missingDocuments = required.filter((d) => !f.documentsPresent.includes(d));
  if (missingDocuments.length)
    exceptions.push({
      code: "missing_documents",
      message: "Missing supporting documents: " + missingDocuments.join(", "),
      amount: null,
    });

  return {
    freeTimeExpiresOn: fromDay(firstChargeable),
    elapsedDays: elapsed,
    chargeableDays,
    calculatedAmount,
    invoicedAmount,
    invoicedDays,
    overchargeAmount,
    duplicateAmount,
    dayLines,
    totals,
    exceptions,
    missingDocuments,
    customerRebillAmount,
    fallbackRebillAmount,
    currency: f.currency,
  };
}
