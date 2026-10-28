// Claim follow-up tracking and the net recovery report. Nothing is sent from here:
// the user (or their mail client) sends; this records what was sent, when a reply is
// due, when to escalate, and what money was actually confirmed.
export type ClaimParty = "carrier_terminal" | "customer";
export type ClaimOutcome =
  "credited" | "partial_credit" | "rebilled_and_paid" | "waived" | "rejected";

export interface ClaimEvent {
  at: string; // ISO date-time
  kind: "sent" | "reminder_sent" | "escalated" | "response_received" | "outcome";
  note?: string;
  outcome?: ClaimOutcome;
  amount?: number; // confirmed money for outcomes
  evidence?: string; // credit note / payment reference
}

export interface ClaimTrack {
  party: ClaimParty;
  channel: "email" | "portal" | "post" | "phone";
  recipient: string;
  reference?: string;
  sentAt: string;
  amountClaimed: number;
  currency: string;
  events: ClaimEvent[];
}

export type NextAction =
  | { action: "wait"; dueOn: string }
  | { action: "send_reminder"; dueOn: string; overdueBusinessDays: number }
  | { action: "escalate"; dueOn: string; overdueBusinessDays: number }
  | { action: "final_notice"; dueOn: string; overdueBusinessDays: number }
  | { action: "closed" };

export const FOLLOW_UP_POLICY = {
  replyDays: 10,
  reminderAfter: 10,
  escalateAfter: 15,
  finalAfter: 25,
};

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function isBusinessDay(d: Date, holidays: string[] = []): boolean {
  const w = d.getUTCDay();
  return w !== 0 && w !== 6 && !holidays.includes(iso(d));
}
export function addBusinessDays(fromIso: string, n: number, holidays: string[] = []): string {
  let d = new Date(fromIso.slice(0, 10) + "T00:00:00Z");
  let left = n;
  while (left > 0) {
    d = new Date(d.getTime() + DAY);
    if (isBusinessDay(d, holidays)) left--;
  }
  return iso(d);
}
export function businessDaysBetween(aIso: string, bIso: string, holidays: string[] = []): number {
  let d = new Date(aIso.slice(0, 10) + "T00:00:00Z");
  const end = new Date(bIso.slice(0, 10) + "T00:00:00Z");
  let n = 0;
  while (d < end) {
    d = new Date(d.getTime() + DAY);
    if (isBusinessDay(d, holidays)) n++;
  }
  return n;
}

export function isClosed(t: ClaimTrack): boolean {
  return t.events.some((e) => e.kind === "outcome");
}

export function nextAction(t: ClaimTrack, todayIso: string, holidays: string[] = []): NextAction {
  if (isClosed(t)) return { action: "closed" };
  const lastTouch = [...t.events].reverse().find((e) => e.kind === "response_received");
  const base = (lastTouch ?? { at: t.sentAt }).at.slice(0, 10);
  const dueOn = addBusinessDays(base, FOLLOW_UP_POLICY.replyDays, holidays);
  const sinceSent = businessDaysBetween(t.sentAt, todayIso, holidays);
  const escalated = t.events.some((e) => e.kind === "escalated");
  const reminded = t.events.some((e) => e.kind === "reminder_sent");
  const overdue = businessDaysBetween(dueOn, todayIso, holidays);
  if (todayIso <= dueOn) return { action: "wait", dueOn };
  if (escalated && sinceSent >= FOLLOW_UP_POLICY.finalAfter)
    return { action: "final_notice", dueOn, overdueBusinessDays: overdue };
  if (!reminded && sinceSent >= FOLLOW_UP_POLICY.reminderAfter)
    return { action: "send_reminder", dueOn, overdueBusinessDays: overdue };
  if (reminded && !escalated && sinceSent >= FOLLOW_UP_POLICY.escalateAfter)
    return { action: "escalate", dueOn, overdueBusinessDays: overdue };
  return { action: "wait", dueOn };
}

export function recordSent(args: Omit<ClaimTrack, "events">): ClaimTrack {
  if (!(args.amountClaimed > 0)) throw new Error("CLAIM_AMOUNT_REQUIRED");
  return { ...args, events: [{ at: args.sentAt, kind: "sent" }] };
}

export function recordEvent(t: ClaimTrack, e: ClaimEvent): ClaimTrack {
  if (isClosed(t)) throw new Error("CLAIM_ALREADY_CLOSED");
  if (e.kind === "outcome") {
    if (!e.outcome) throw new Error("OUTCOME_REQUIRED");
    if (e.outcome !== "rejected") {
      if (!(e.amount != null && e.amount > 0)) throw new Error("CONFIRMED_AMOUNT_REQUIRED");
      if (!e.evidence?.trim())
        throw new Error("EVIDENCE_REQUIRED: credit note, remittance or payment reference");
      if (e.amount > t.amountClaimed + 0.005) throw new Error("AMOUNT_EXCEEDS_CLAIM");
    }
  }
  return { ...t, events: [...t.events, e] };
}

export interface RecoveryReport {
  currency: string;
  claimed: number;
  confirmedRecovered: number;
  rejected: number;
  openClaims: number;
  openAmount: number;
  successFeePercent: number | null;
  successFee: number | null;
  netToClient: number | null;
  byParty: Record<ClaimParty, { claimed: number; recovered: number }>;
  claims: {
    reference: string | null;
    party: ClaimParty;
    claimed: number;
    recovered: number;
    status: string;
  }[];
}

// Only confirmed outcomes (amount + evidence) count as money. Open claims are shown
// separately as pending, never added to recovered. Mixed currencies are refused.
export function buildRecoveryReport(
  tracks: ClaimTrack[],
  successFeePercent: number | null = null,
): RecoveryReport {
  const currencies = new Set(tracks.map((t) => t.currency));
  if (currencies.size > 1) throw new Error("CURRENCY_MISMATCH: report one currency at a time");
  const currency = [...currencies][0] ?? "ZAR";
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const byParty: RecoveryReport["byParty"] = {
    carrier_terminal: { claimed: 0, recovered: 0 },
    customer: { claimed: 0, recovered: 0 },
  };
  let claimed = 0,
    recovered = 0,
    rejected = 0,
    openAmount = 0,
    open = 0;
  const claims: RecoveryReport["claims"] = [];
  for (const t of tracks) {
    const out = t.events.find((e) => e.kind === "outcome");
    const got = out && out.outcome !== "rejected" ? (out.amount ?? 0) : 0;
    claimed += t.amountClaimed;
    byParty[t.party].claimed += t.amountClaimed;
    byParty[t.party].recovered += got;
    recovered += got;
    if (!out) {
      open++;
      openAmount += t.amountClaimed;
    }
    if (out?.outcome === "rejected") rejected += t.amountClaimed;
    claims.push({
      reference: t.reference ?? null,
      party: t.party,
      claimed: t.amountClaimed,
      recovered: r2(got),
      status: out ? out.outcome! : "open",
    });
  }
  const fee = successFeePercent == null ? null : r2((recovered * successFeePercent) / 100);
  return {
    currency,
    claimed: r2(claimed),
    confirmedRecovered: r2(recovered),
    rejected: r2(rejected),
    openClaims: open,
    openAmount: r2(openAmount),
    successFeePercent,
    successFee: fee,
    netToClient: fee == null ? null : r2(recovered - fee),
    byParty: {
      carrier_terminal: {
        claimed: r2(byParty.carrier_terminal.claimed),
        recovered: r2(byParty.carrier_terminal.recovered),
      },
      customer: {
        claimed: r2(byParty.customer.claimed),
        recovered: r2(byParty.customer.recovered),
      },
    },
    claims,
  };
}
