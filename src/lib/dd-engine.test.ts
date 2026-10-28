import { describe, expect, it } from "vitest";
import { analyseDd, type DdFacts } from "./dd-analysis";
import { calculateDemurrage } from "./investigation-engine";
import { buildDisputePack } from "./dd-dispute";
import {
  addBusinessDays,
  buildRecoveryReport,
  nextAction,
  recordEvent,
  recordSent,
  type ClaimTrack,
} from "./dd-followup";
import {
  findContainerNos,
  findDates,
  guessDocType,
  isValidContainerNo,
  parseInvoiceText,
  parseNoticeEmail,
  parseTerminalReleaseCsv,
} from "./dd-ingest";

// Synthetic example from the managed-service brief: R18,500 import container.
const base = (over: Partial<DdFacts> = {}): DdFacts => ({
  containerNo: "MSCU6639870",
  carrier: "Synthetic Line",
  terminal: "Synthetic Terminal",
  currency: "ZAR",
  dischargeDate: "2026-03-01",
  freeDays: 3,
  gateOutDate: "2026-03-09",
  units: 1,
  rateTiers: [{ fromDay: 1, dailyRate: 3700 }],
  invoices: [{ invoiceNo: "INV-1001", chargeType: "demurrage", days: 5, amount: 18500 }],
  delayEvents: [
    {
      from: "2026-03-04",
      to: "2026-03-08",
      cause: "terminal",
      description: "Terminal gate system outage",
      source: "terminal-notice.txt",
    },
  ],
  customerBilledAmount: 0,
  contractClause: "Clause 7.2 of the synthetic services agreement",
  documentsPresent: [
    "bill_of_lading",
    "tariff_or_free_time",
    "terminal_release",
    "carrier_invoice",
    "terminal_notice",
    "customer_invoice",
  ],
  ...over,
});

describe("analyseDd", () => {
  it("matches the existing calculator and classifies the R18,500 example", () => {
    const a = analyseDd(base());
    const calc = calculateDemurrage({
      start: "2026-03-01T00:00:00Z",
      release: "2026-03-09T00:00:00Z",
      freeDays: 3,
      units: 1,
      currency: "ZAR",
      tieredRates: [{ fromDay: 1, dailyRate: 3700 }],
    });
    expect(a.chargeableDays).toBe(calc.chargeable);
    expect(a.calculatedAmount).toBe(calc.total);
    expect(a.freeTimeExpiresOn).toBe("2026-03-04");
    expect(
      a.totals.find((t) => t.classification === "disputable_with_carrier_terminal"),
    ).toMatchObject({ days: 5, amount: 18500 });
    expect(a.exceptions.map((e) => e.code)).toEqual(
      expect.arrayContaining([
        "free_time_expired",
        "terminal_or_carrier_caused",
        "not_billed_to_customer",
      ]),
    );
    expect(a.fallbackRebillAmount).toBe(18500);
    expect(a.missingDocuments).toEqual([]);
  });
  it("splits days by cause with documented precedence", () => {
    const a = analyseDd(
      base({
        delayEvents: [
          {
            from: "2026-03-04",
            to: "2026-03-05",
            cause: "terminal",
            description: "outage",
            source: "n1",
          },
          {
            from: "2026-03-05",
            to: "2026-03-06",
            cause: "customer",
            description: "late payment",
            source: "n2",
          },
          {
            from: "2026-03-07",
            to: "2026-03-07",
            cause: "forwarder",
            description: "truck late",
            source: "n3",
          },
        ],
      }),
    );
    const by = Object.fromEntries(a.totals.map((t) => [t.classification, t.days]));
    expect(by).toEqual({
      disputable_with_carrier_terminal: 2,
      recoverable_from_customer: 1,
      avoidable_next_time: 1,
      correctly_payable: 1,
    });
    expect(a.customerRebillAmount).toBe(3700);
  });
  it("flags wrong days and duplicates", () => {
    const a = analyseDd(
      base({
        delayEvents: [],
        invoices: [
          { invoiceNo: "INV-1", chargeType: "demurrage", days: 7, amount: 25900 },
          { invoiceNo: "INV-1", chargeType: "demurrage", days: 7, amount: 25900 },
        ],
      }),
    );
    const codes = a.exceptions.map((e) => e.code);
    expect(codes).toContain("duplicate_charge");
    expect(codes).toContain("wrong_days");
    expect(a.duplicateAmount).toBe(25900);
    expect(a.overchargeAmount).toBe(25900 - 18500);
  });
  it("reports missing documents and never treats unknown customer billing as zero", () => {
    const a = analyseDd(
      base({ customerBilledAmount: null, documentsPresent: ["carrier_invoice"] }),
    );
    expect(a.missingDocuments).toEqual(
      expect.arrayContaining(["bill_of_lading", "terminal_release", "terminal_notice"]),
    );
    expect(a.customerRebillAmount).toBe(0);
    expect(a.fallbackRebillAmount).toBe(0);
  });
  it("no delay event means payable, no free-time expiry means no charges", () => {
    expect(
      analyseDd(base({ delayEvents: [] })).totals.find(
        (t) => t.classification === "correctly_payable",
      )!.amount,
    ).toBe(18500);
    const none = analyseDd(
      base({
        gateOutDate: "2026-03-03",
        invoices: [{ invoiceNo: "X", chargeType: "demurrage", amount: 0 }],
      }),
    );
    expect(none.chargeableDays).toBe(0);
    expect(() => analyseDd(base({ gateOutDate: "2026-02-01" }))).toThrow(
      "GATE_OUT_BEFORE_DISCHARGE",
    );
  });
  it("tiered rates", () => {
    const a = analyseDd(
      base({
        rateTiers: [
          { fromDay: 1, toDay: 3, dailyRate: 500 },
          { fromDay: 4, dailyRate: 800 },
        ],
        delayEvents: [],
        invoices: [{ invoiceNo: "T", chargeType: "demurrage", amount: 3100 }],
      }),
    );
    expect(a.calculatedAmount).toBe(3 * 500 + 2 * 800);
    expect(a.exceptions.some((e) => e.code === "wrong_days")).toBe(false);
  });
});

describe("buildDisputePack", () => {
  const sender = { companyName: "Synthetic Forwarding (Pty) Ltd", contactName: "A. Tester" };
  it("builds a ready carrier letter with timeline, basis and amount", () => {
    const f = base();
    const p = buildDisputePack(f, analyseDd(f), sender);
    const l = p.letters.find((x) => x.party === "carrier_terminal")!;
    expect(l.readyToSend).toBe(true);
    expect(l.amount).toBe(18500);
    expect(l.body).toContain("Credit requested: ZAR 18500.00");
    expect(l.body).toContain("Clause 7.2");
    expect(l.body).toContain("Terminal gate system outage");
    expect(p.timeline[0].date).toBe("2026-03-01");
    expect(p.recommendedResponse).toContain("credit request");
  });
  it("refuses to mark a letter ready without a clause or notice", () => {
    const f = base({ contractClause: undefined, documentsPresent: ["carrier_invoice"] });
    const l = buildDisputePack(f, analyseDd(f), sender).letters[0];
    expect(l.readyToSend).toBe(false);
    expect(l.blockers.join(" ")).toMatch(/clause/i);
    expect(l.body).toContain("[ADD CLAUSE BEFORE SENDING]");
  });
  it("customer rebill letter for customer-caused days", () => {
    const f = base({
      delayEvents: [
        {
          from: "2026-03-04",
          to: "2026-03-08",
          cause: "customer",
          description: "Importer late with payment",
          source: "email",
        },
      ],
    });
    const p = buildDisputePack(f, analyseDd(f), sender);
    expect(p.letters.map((l) => l.party)).toEqual(["customer"]);
    expect(p.letters[0].amount).toBe(18500);
  });
});

describe("follow-up and net recovery", () => {
  const mk = (): ClaimTrack =>
    recordSent({
      party: "carrier_terminal",
      channel: "email",
      recipient: "ar@line.example",
      reference: "CR-1",
      sentAt: "2026-03-10T08:00:00Z",
      amountClaimed: 18500,
      currency: "ZAR",
    });
  it("business-day schedule and escalation ladder", () => {
    expect(addBusinessDays("2026-03-10", 10)).toBe("2026-03-24");
    const t = mk();
    expect(nextAction(t, "2026-03-20")).toEqual({ action: "wait", dueOn: "2026-03-24" });
    expect(nextAction(t, "2026-03-25").action).toBe("send_reminder");
    const r = recordEvent(t, { at: "2026-03-25T08:00:00Z", kind: "reminder_sent" });
    expect(nextAction(r, "2026-03-25").action).toBe("wait");
    expect(nextAction(r, "2026-03-31").action).toBe("escalate");
    const e = recordEvent(r, { at: "2026-03-31T08:00:00Z", kind: "escalated" });
    expect(nextAction(e, "2026-04-15").action).toBe("final_notice");
  });
  it("money counts only with amount and evidence, and cannot exceed the claim", () => {
    const t = mk();
    expect(() =>
      recordEvent(t, {
        at: "2026-04-01T00:00:00Z",
        kind: "outcome",
        outcome: "credited",
        amount: 1000,
      }),
    ).toThrow("EVIDENCE_REQUIRED");
    expect(() =>
      recordEvent(t, {
        at: "2026-04-01T00:00:00Z",
        kind: "outcome",
        outcome: "credited",
        evidence: "CN-9",
      }),
    ).toThrow("CONFIRMED_AMOUNT_REQUIRED");
    expect(() =>
      recordEvent(t, {
        at: "2026-04-01T00:00:00Z",
        kind: "outcome",
        outcome: "credited",
        amount: 99999,
        evidence: "CN-9",
      }),
    ).toThrow("AMOUNT_EXCEEDS_CLAIM");
  });
  it("report: pending is not recovered; fee on confirmed only; closed claims immutable", () => {
    const a = recordEvent(mk(), {
      at: "2026-04-01T00:00:00Z",
      kind: "outcome",
      outcome: "partial_credit",
      amount: 12000,
      evidence: "CN-77",
    });
    const b = recordSent({
      party: "customer",
      channel: "email",
      recipient: "c@x.example",
      sentAt: "2026-03-12T00:00:00Z",
      amountClaimed: 5000,
      currency: "ZAR",
    });
    const c = recordEvent(
      recordSent({
        party: "carrier_terminal",
        channel: "portal",
        recipient: "p",
        sentAt: "2026-03-12T00:00:00Z",
        amountClaimed: 2000,
        currency: "ZAR",
      }),
      { at: "2026-04-02T00:00:00Z", kind: "outcome", outcome: "rejected" },
    );
    const r = buildRecoveryReport([a, b, c], 25);
    expect(r).toMatchObject({
      claimed: 25500,
      confirmedRecovered: 12000,
      rejected: 2000,
      openClaims: 1,
      openAmount: 5000,
      successFee: 3000,
      netToClient: 9000,
    });
    expect(() => recordEvent(a, { at: "2026-04-03T00:00:00Z", kind: "reminder_sent" })).toThrow(
      "CLAIM_ALREADY_CLOSED",
    );
    expect(buildRecoveryReport([b]).confirmedRecovered).toBe(0);
  });
});

describe("ingestion", () => {
  it("validates container numbers with ISO 6346 check digit", () => {
    expect(isValidContainerNo("MSCU6639870")).toBe(true);
    expect(isValidContainerNo("MSCU6639871")).toBe(false);
    expect(findContainerNos("Box MSCU 663987 0 and CMAU1234564, junk ABCU1234567")).toEqual([
      "MSCU6639870",
      "CMAU1234564",
    ]);
  });
  it("finds dates in ISO, long and day-first formats", () => {
    expect(findDates("2026-03-04, 4 March 2026, 04/03/2026, 31/02/2026")).toEqual([
      "2026-03-04",
      "2026-03-04",
      "2026-03-04",
    ]);
  });
  it("parses invoice text into lines that reconcile", () => {
    const t =
      "Synthetic Line\nInvoice No: INV-1001\nContainer MSCU6639870\nDemurrage | 5 | 3700.00 | 18500.00\nBad row | 2 | 100.00 | 999.00\nTotal due: ZAR 18500.00\nDate 09 March 2026";
    const p = parseInvoiceText(t);
    expect(p.invoiceNo).toBe("INV-1001");
    expect(p.lines).toEqual([
      { description: "Demurrage", quantity: 5, unitPrice: 3700, amount: 18500 },
    ]);
    expect(p.total).toBe(18500);
    expect(p.days).toBe(5);
    expect(p.currency).toBe("ZAR");
    expect(p.containerNos).toEqual(["MSCU6639870"]);
  });
  it("reads terminal release CSV", () => {
    const r = parseTerminalReleaseCsv(
      "Container,Release Date,Gate Out\nMSCU6639870,2026-03-02,2026-03-09\nBAD123,2026-03-01,2026-03-01",
    );
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      containerNo: "MSCU6639870",
      gateOutDate: "2026-03-09",
      releaseDate: "2026-03-02",
    });
  });
  it("proposes cause and window from a forwarded notice, never confirms", () => {
    const n = parseNoticeEmail(
      "From: ops@terminal.example\nDate: 2026-03-09\nSubject: Gate system outage\n\nThe gate system outage ran from 4 March 2026 to 8 March 2026. Affects MSCU6639870.",
    );
    expect(n.proposedCause).toBe("terminal");
    expect(n.delayWindow).toEqual({ from: "2026-03-04", to: "2026-03-08" });
    expect(n.containerNos).toEqual(["MSCU6639870"]);
    expect(parseNoticeEmail("Hello, rates attached.").proposedCause).toBeNull();
  });
  it("guesses document types", () => {
    expect(guessDocType("terminal-notice.txt")).toBe("terminal_notice");
    expect(guessDocType("gate-out release.csv")).toBe("terminal_release");
    expect(guessDocType("demurrage invoice.pdf")).toBe("carrier_invoice");
  });
});
