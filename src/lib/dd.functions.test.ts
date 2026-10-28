import { beforeEach, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & {
  id: string;
  status: string;
  calculation: Record<string, unknown>;
};
const st = vi.hoisted(() => ({
  role: "investigator",
  rows: [] as Row[],
  files: {} as Record<string, string>,
}));
vi.mock("@/lib/auth-middleware", () => ({ tenantMiddleware: {} }));
vi.mock("@/lib/integrated-feature-gate", () => ({ requireIntegratedFeatureReady: vi.fn() }));
vi.mock("@/lib/pdf-text", () => ({ readPdfPages: vi.fn() }));

// In-memory stand-in for the few Supabase calls the D&D functions make.
function query(table: string) {
  const f: Record<string, unknown> = {};
  let patch: Record<string, unknown> | null = null;
  const b: Record<string, unknown> = {
    select: () => b,
    update: (p: Record<string, unknown>) => ((patch = p), b),
    eq: (k: string, v: unknown) => ((f[k] = v), b),
    in: (k: string, v: unknown[]) => ((f[k + "_in"] = v), b),
    maybeSingle: async () => {
      const t = table === "recovery_findings" ? st.rows : docs;
      const hit = (t as Row[]).find((r) =>
        Object.entries(f).every(([k, v]) =>
          k.endsWith("_in")
            ? (v as unknown[]).includes(r[k.slice(0, -3)])
            : k === "tenant_id" || r[k] === v,
        ),
      );
      if (hit && patch) Object.assign(hit, patch);
      return { data: hit ?? null, error: null };
    },
    then: (res: (v: unknown) => unknown) => {
      const t = (table === "recovery_findings" ? st.rows : docs) as Row[];
      return res({
        data: t.filter((r) =>
          Object.entries(f).every(([k, v]) =>
            k.endsWith("_in")
              ? (v as unknown[]).includes(r[k.slice(0, -3)])
              : k === "tenant_id" || r[k] === v,
          ),
        ),
        error: null,
      });
    },
  };
  return b;
}
const docs: Row[] = [];
const supabase = {
  from: (t: string) => query(t === "cases" ? "cases_t" : t),
  rpc: vi.fn(async (name: string, args: { p_rows: Record<string, unknown>[] }) => {
    if (name !== "cargoiq_create_recovery_batch")
      return { data: null, error: { message: "unexpected rpc" } };
    const created = args.p_rows.map((r, i) => ({
      id: "00000000-0000-4000-8000-0000000001" + String(10 + st.rows.length + i),
      status: "new",
      currency: r.currency,
      case_id: r.case_id,
      title: r.title,
      calculation: r.calculation as Record<string, unknown>,
    }));
    st.rows.push(...(created as Row[]));
    return { data: created, error: null };
  }),
  storage: {
    from: () => ({
      download: async (p: string) => ({
        data: { text: async () => st.files[p] ?? "" },
        error: null,
      }),
    }),
  },
};
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const b = {
      validator: (v: { parse?: (x: unknown) => unknown }) => (
        ((b as Record<string, unknown>).v = v),
        b
      ),
      middleware: () => b,
      handler: (fn: (a: unknown) => unknown) => (arg: { data: unknown }) =>
        fn({
          data: (b as { v?: { parse?: (x: unknown) => unknown } }).v?.parse?.(arg.data) ?? arg.data,
          context: { role: st.role, tenantId: "t1", user: { id: "u1" }, supabase },
        }),
    };
    return b;
  },
}));
import {
  getDdFollowUps,
  getRecoveryReport,
  recordClaimEvent,
  recordClaimSent,
  runManagedDd,
  ingestDdEvidence,
} from "./dd.functions";

const U = (n: number) => "00000000-0000-4000-8000-00000000000" + n;
const facts = {
  containerNo: "MSCU6639870",
  carrier: "Synthetic Line",
  terminal: "T",
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
      description: "Gate outage",
      source: "n.txt",
    },
  ],
  customerBilledAmount: 0,
  contractClause: "Clause 7.2",
  documentsPresent: [
    "bill_of_lading",
    "tariff_or_free_time",
    "terminal_release",
    "carrier_invoice",
    "terminal_notice",
    "customer_invoice",
  ],
};
const sender = { companyName: "Synthetic Fwd", contactName: "A. Tester" };

beforeEach(() => {
  st.role = "investigator";
  st.rows.length = 0;
  docs.length = 0;
  supabase.rpc.mockClear();
});

it("viewer cannot run or record anything", async () => {
  st.role = "viewer";
  await expect(
    runManagedDd({
      data: { caseId: U(1), requestId: U(2), facts, sender, sourceDocumentIds: [] },
    } as never),
  ).rejects.toThrow("Investigator access required");
  expect(supabase.rpc).not.toHaveBeenCalled();
});

it("full lifecycle: save -> approve -> sent -> reminder -> confirmed outcome -> report", async () => {
  // cases lookup uses the same fake; seed a case row through the generic table
  (supabase as { from: unknown }).from = (t: string) =>
    t === "cases"
      ? {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { id: U(1) }, error: null }) }),
            }),
          }),
        }
      : query(t);
  const res = await runManagedDd({
    data: { caseId: U(1), requestId: U(2), facts, sender, sourceDocumentIds: [] },
  } as never);
  expect(res.created).toHaveLength(1);
  expect(
    res.analysis.totals.find((t) => t.classification === "disputable_with_carrier_terminal")
      ?.amount,
  ).toBe(18500);
  const id = st.rows[0].id;
  // cannot record sent before approval
  await expect(
    recordClaimSent({
      data: {
        findingId: id,
        channel: "email",
        recipient: "ar@line.example",
        sentAt: "2026-03-10T08:00:00.000Z",
      },
    } as never),
  ).rejects.toThrow("APPROVE_FINDING_FIRST");
  st.rows[0].status = "approved";
  await recordClaimSent({
    data: {
      findingId: id,
      channel: "email",
      recipient: "ar@line.example",
      reference: "CR-1",
      sentAt: "2026-03-10T08:00:00.000Z",
    },
  } as never);
  expect(st.rows[0].status).toBe("submitted");
  await expect(
    recordClaimSent({
      data: { findingId: id, channel: "email", recipient: "x", sentAt: "2026-03-10T08:00:00.000Z" },
    } as never),
  ).rejects.toThrow();
  const fu = await getDdFollowUps({ data: { caseId: U(1), today: "2026-03-25" } } as never);
  expect(fu[0].next.action).toBe("send_reminder");
  await recordClaimEvent({
    data: { findingId: id, event: { kind: "reminder_sent", at: "2026-03-25T08:00:00.000Z" } },
  } as never);
  // money without confirmation or evidence is refused; status stays submitted
  await expect(
    recordClaimEvent({
      data: {
        findingId: id,
        event: {
          kind: "outcome",
          at: "2026-04-01T08:00:00.000Z",
          outcome: "credited",
          amount: 12000,
          evidence: "CN-77",
        },
      },
    } as never),
  ).rejects.toThrow("RECOVERY_CONFIRMATION_REQUIRED");
  await expect(
    recordClaimEvent({
      data: {
        findingId: id,
        event: {
          kind: "outcome",
          at: "2026-04-01T08:00:00.000Z",
          outcome: "credited",
          amount: 12000,
          confirmReceived: true,
        },
      },
    } as never),
  ).rejects.toThrow("EVIDENCE_REQUIRED");
  expect(st.rows[0].status).toBe("submitted");
  const before = await getRecoveryReport({
    data: { caseId: U(1), successFeePercent: null },
  } as never);
  expect(before[0]).toMatchObject({ confirmedRecovered: 0, openAmount: 18500 });
  await recordClaimEvent({
    data: {
      findingId: id,
      event: {
        kind: "outcome",
        at: "2026-04-01T08:00:00.000Z",
        outcome: "partial_credit",
        amount: 12000,
        evidence: "CN-77",
        confirmReceived: true,
      },
    },
  } as never);
  expect(st.rows[0].status).toBe("recovered");
  const after = await getRecoveryReport({ data: { caseId: U(1), successFeePercent: 25 } } as never);
  expect(after[0]).toMatchObject({
    confirmedRecovered: 12000,
    openClaims: 0,
    successFee: 3000,
    netToClient: 9000,
  });
});

it("ingest reads text documents from the case path and returns proposals only", async () => {
  docs.push({
    id: U(5),
    status: "",
    calculation: {},
    name: "demurrage invoice.txt",
    file_path: "t1/" + U(1) + "/inv.txt",
    file_type: "text/plain",
    case_id: U(1),
    tenant_id: "t1",
  } as Row);
  st.files["t1/" + U(1) + "/inv.txt"] =
    "Invoice No: INV-1001\nMSCU6639870\nDemurrage | 5 | 3700.00 | 18500.00\nTotal due: ZAR 18500.00";
  const out = await ingestDdEvidence({ data: { caseId: U(1), documentIds: [U(5)] } } as never);
  expect(out[0]).toMatchObject({ docType: "carrier_invoice", proposalOnly: true });
  expect(out[0].invoice?.total).toBe(18500);
  docs[0].file_path = "other/" + U(1) + "/inv.txt";
  await expect(
    ingestDdEvidence({ data: { caseId: U(1), documentIds: [U(5)] } } as never),
  ).rejects.toThrow("INVALID_STORAGE_PATH");
});
