// Revenue Recovery Engine: pure comparison and status-machine logic.
// Honest-money rules: an amount is only "recovered" after explicit confirmation
// of an already-submitted claim; everything before that is exposure or discrepancy.
import { z } from "zod";

export const FINDING_TYPES = [
  "duplicate_invoice_charge",
  "missed_billing",
  "avoidable_demurrage_detention",
  "contract_charge_discrepancy",
  "unmatched_supplier_charge",
  "third_party_recoverable",
] as const;
export type FindingType = (typeof FINDING_TYPES)[number];

export const RECOVERY_STATUSES = [
  "new",
  "under_review",
  "approved",
  "rejected",
  "submitted",
  "recovered",
] as const;
export type RecoveryStatus = (typeof RECOVERY_STATUSES)[number];

// Allowed transitions. "recovered" only from "submitted".
const TRANSITIONS: Record<RecoveryStatus, RecoveryStatus[]> = {
  new: ["under_review", "rejected"],
  under_review: ["approved", "rejected"],
  approved: ["submitted", "rejected"],
  rejected: [],
  submitted: ["recovered", "rejected"],
  recovered: [],
};

export function assertValidTransition(from: RecoveryStatus, to: RecoveryStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new Error(
      "INVALID_STATUS_TRANSITION: " +
        from +
        " -> " +
        to +
        ". Allowed from " +
        from +
        ": " +
        (TRANSITIONS[from].join(", ") || "none (terminal)"),
    );
  }
}

export const invoiceLine = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().finite().nonnegative().default(1),
  unitPrice: z.number().finite().nonnegative(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/)
    .default("ZAR"),
  source: z.string().max(500).optional(),
});
export type InvoiceLine = z.infer<typeof invoiceLine>;

export interface LineDiscrepancy {
  kind: "amount_mismatch" | "missing_charge" | "unexpected_charge" | "duplicate_charge";
  description: string;
  expectedAmount: number | null;
  actualAmount: number | null;
  difference: number | null;
  currency: string;
  breakdown: string;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const lineTotal = (l: InvoiceLine) => Math.round(l.quantity * l.unitPrice * 100) / 100;

export function compareInvoiceLines(
  expected: InvoiceLine[],
  actual: InvoiceLine[],
): LineDiscrepancy[] {
  if (!expected.length || !actual.length)
    throw new Error("EMPTY_COMPARISON: both line sets required");
  expected = expected.map((l) => invoiceLine.parse(l));
  actual = actual.map((l) => invoiceLine.parse(l));
  const out: LineDiscrepancy[] = [];
  const expCurrencies = new Set(expected.map((l) => l.currency));
  const actCurrencies = new Set(actual.map((l) => l.currency));
  if (
    expCurrencies.size > 1 ||
    actCurrencies.size > 1 ||
    [...expCurrencies][0] !== [...actCurrencies][0]
  ) {
    throw new Error("CURRENCY_MISMATCH: comparison requires one shared currency");
  }
  const currency = [...expCurrencies][0] ?? [...actCurrencies][0] ?? "ZAR";

  // Match occurrences one-to-one. Repeated descriptions are common on real
  // invoices; an actual line must never pay for two expected lines. Prefer an
  // exact amount match before falling back to the first unused occurrence.
  const used = new Set<number>();
  const exactMatches = new Map<number, number>();
  // Reserve all exact matches first, so an early mismatch cannot consume a
  // later exact counterpart with the same description.
  for (const [ei, e] of expected.entries()) {
    const ai = actual.findIndex(
      (a, i) =>
        !used.has(i) &&
        norm(a.description) === norm(e.description) &&
        lineTotal(a) === lineTotal(e),
    );
    if (ai >= 0) {
      used.add(ai);
      exactMatches.set(ei, ai);
    }
  }
  for (const [ei, e] of expected.entries()) {
    const exact = exactMatches.get(ei);
    const ai =
      exact ??
      actual.findIndex((a, i) => !used.has(i) && norm(a.description) === norm(e.description));
    const match = ai >= 0 ? { a: actual[ai], i: ai } : undefined;
    if (!match) {
      out.push({
        kind: "missing_charge",
        description: e.description,
        expectedAmount: lineTotal(e),
        actualAmount: null,
        difference: null,
        currency,
        breakdown:
          "Expected " +
          lineTotal(e).toFixed(2) +
          " (" +
          e.quantity +
          " x " +
          e.unitPrice.toFixed(2) +
          ") has no unused actual counterpart",
      });
      continue;
    }
    used.add(match.i);
    const diff = Math.round((lineTotal(match.a) - lineTotal(e)) * 100) / 100;
    if (diff !== 0)
      out.push({
        kind: "amount_mismatch",
        description: e.description,
        expectedAmount: lineTotal(e),
        actualAmount: lineTotal(match.a),
        difference: diff,
        currency,
        breakdown:
          "Expected " +
          lineTotal(e).toFixed(2) +
          " vs actual " +
          lineTotal(match.a).toFixed(2) +
          " = " +
          (diff > 0 ? "+" : "") +
          diff.toFixed(2),
      });
  }
  for (const [i, a] of actual.entries()) {
    if (used.has(i)) continue;
    const hasExpected = expected.some((e) => norm(e.description) === norm(a.description));
    out.push({
      kind: hasExpected ? "duplicate_charge" : "unexpected_charge",
      description: a.description,
      expectedAmount: null,
      actualAmount: lineTotal(a),
      difference: lineTotal(a),
      currency,
      breakdown: hasExpected
        ? "Surplus occurrence beyond expected lines with this description. Potential duplicate only: verify source documents."
        : "Actual charge " + lineTotal(a).toFixed(2) + " has no expected counterpart",
    });
  }
  return out;
}

export function summariseDiscrepancies(ds: LineDiscrepancy[]): {
  totalExposure: number;
  currency: string | null;
  byKind: Record<string, number>;
} {
  const byKind: Record<string, number> = {};
  let total = 0;
  let currency: string | null = null;
  for (const d of ds) {
    byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
    if (d.difference != null && d.difference > 0) total += d.difference;
    currency = currency ?? d.currency;
  }
  return { totalExposure: Math.round(total * 100) / 100, currency, byKind };
}

export function findingTypeFor(kind: LineDiscrepancy["kind"]): FindingType {
  switch (kind) {
    case "duplicate_charge":
      return "duplicate_invoice_charge";
    case "missing_charge":
      return "missed_billing";
    case "unexpected_charge":
      return "unmatched_supplier_charge";
    case "amount_mismatch":
      return "contract_charge_discrepancy";
  }
}
