// Evidence ledger and finding categories (evidence pack v0).
//  arithmetic_discrepancy   invoice does not match tariff and timeline for the same facts
//  potentially_disputable   a day caused by the terminal or carrier, supported by ledger evidence
//  unsupported_claim        a cause is asserted but no usable evidence supports it
//  recoverable_claim        ONLY when a credit note is recorded (evidenced credit)
// Nothing here is called recovered unless a credit note reference and amount exist.
import type { Recompute } from "./dd-tariff";
import { toDay } from "./dd-analysis";

export const EVIDENCE_STATUS = ["VERIFIED", "DERIVED", "INFERRED", "DISPUTED", "UNKNOWN"] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUS)[number];

export interface EvidenceEntry {
  id: string;
  kind:
    | "terminal_notice"
    | "vessel_update"
    | "appointment_screenshot"
    | "hold_record"
    | "email"
    | "other";
  description: string;
  source: string; // document name or URL supplied by the user
  capturedAt: string | null; // ISO date-time when the evidence was captured, null if unknown
  suppliedBy: string;
  coversFrom: string; // YYYY-MM-DD
  coversTo: string; // YYYY-MM-DD inclusive
  cause: "terminal" | "carrier";
  status: EvidenceStatus;
}

export type FindingCategory =
  "arithmetic_discrepancy" | "potentially_disputable" | "unsupported_claim" | "recoverable_claim";

export interface Finding {
  category: FindingCategory;
  amount: number | null;
  days?: string[];
  evidenceIds?: string[];
  note: string;
}

export interface CreditOutcome {
  creditNoteRef: string;
  creditAmount: number;
}

export interface FindingsInput {
  recompute: Recompute;
  invoicedAmount: number;
  duplicateAmount?: number;
  ledger: EvidenceEntry[];
  assertedDelayDays: string[]; // days the user says were caused by terminal or carrier
  credit?: CreditOutcome | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
// Evidence is usable only if verified or derived and it has a capture time and a source.
const usable = (e: EvidenceEntry) =>
  (e.status === "VERIFIED" || e.status === "DERIVED") && !!e.capturedAt && !!e.source.trim();

export function buildFindings(i: FindingsInput): { findings: Finding[]; notes: string[] } {
  const findings: Finding[] = [];
  const notes: string[] = [];
  if (!i.recompute.complete)
    notes.push(
      `${i.recompute.unknownDays} chargeable day(s) have no stated rate: the recomputed total is a lower bound and no discrepancy is asserted for them.`,
    );
  const diff = r2(i.invoicedAmount - i.recompute.knownAmount);
  if (i.recompute.complete && diff > 0)
    findings.push({
      category: "arithmetic_discrepancy",
      amount: diff,
      note: `Invoiced ${i.invoicedAmount} vs recomputed ${i.recompute.knownAmount} on the tariff in force.`,
    });
  if ((i.duplicateAmount ?? 0) > 0)
    findings.push({
      category: "arithmetic_discrepancy",
      amount: i.duplicateAmount as number,
      note: "Duplicate charge identified on the invoices supplied.",
    });
  const ratedByDate = new Map(i.recompute.days.map((d) => [d.date, d]));
  const supported: string[] = [];
  const unsupported: string[] = [];
  const ids = new Set<string>();
  for (const day of i.assertedDelayDays) {
    const cover = i.ledger.filter(
      (e) => toDay(e.coversFrom) <= toDay(day) && toDay(day) <= toDay(e.coversTo) && usable(e),
    );
    if (cover.length) {
      supported.push(day);
      cover.forEach((e) => ids.add(e.id));
    } else unsupported.push(day);
  }
  const sum = (ds: string[]) => r2(ds.reduce((s, d) => s + (ratedByDate.get(d)?.rate ?? 0), 0));
  if (supported.length)
    findings.push({
      category: "potentially_disputable",
      amount: sum(supported),
      days: supported,
      evidenceIds: [...ids],
      note: "Terminal or carrier delay supported by ledger evidence. Liability is a commercial or legal question, not settled here.",
    });
  if (unsupported.length)
    findings.push({
      category: "unsupported_claim",
      amount: null,
      days: unsupported,
      note: "Delay asserted but no usable evidence (status VERIFIED or DERIVED, with source and capture time) covers these days. No amount is counted.",
    });
  if (i.credit && i.credit.creditNoteRef.trim() && i.credit.creditAmount > 0)
    findings.push({
      category: "recoverable_claim",
      amount: i.credit.creditAmount,
      note: `Credit evidenced by ${i.credit.creditNoteRef}.`,
    });
  return { findings, notes };
}
