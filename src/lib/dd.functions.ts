import { requireIntegratedFeatureReady } from "@/lib/integrated-feature-gate";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { tenantMiddleware } from "@/lib/auth-middleware";
import { analyseDd, ddFacts } from "@/lib/dd-analysis";
import { buildDisputePack } from "@/lib/dd-dispute";
import {
  buildRecoveryReport,
  nextAction,
  recordEvent,
  recordSent,
  type ClaimTrack,
} from "@/lib/dd-followup";
import {
  guessDocType,
  parseInvoiceText,
  parseNoticeEmail,
  parseTerminalReleaseCsv,
} from "@/lib/dd-ingest";
import { assertValidTransition } from "@/lib/revenue-recovery";

// Managed D&D dispute workflow. Findings reuse recovery_findings (no new tables): the
// analysis, letter and claim tracking live in calculation.dd. Nothing is sent externally;
// the user sends the letter and records it here.

const MAX_TEXT = 400_000;

function assertInvestigator(role: string) {
  if (!["admin", "investigator"].includes(role)) throw new Error("Investigator access required");
}
type Json = Record<string, unknown>;
const obj = (v: unknown): Json =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};

export const ingestDdEvidence = createServerFn({ method: "POST" })
  .validator(
    z.object({ caseId: z.string().uuid(), documentIds: z.array(z.string().uuid()).min(1).max(20) }),
  )
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    await requireIntegratedFeatureReady(context.supabase);
    assertInvestigator(context.role);
    const { data: docs, error } = await context.supabase
      .from("documents")
      .select("id,name,file_path,file_type,case_id")
      .eq("tenant_id", context.tenantId)
      .eq("case_id", data.caseId)
      .in("id", data.documentIds);
    if (error) throw error;
    if (!docs || docs.length !== new Set(data.documentIds).size)
      throw new Error("DOCUMENT_NOT_IN_CASE");
    const out = [];
    for (const d of docs) {
      if (!d.file_path.startsWith(context.tenantId + "/" + data.caseId + "/"))
        throw new Error("INVALID_STORAGE_PATH");
      const { data: blob, error: dErr } = await context.supabase.storage
        .from("case-documents")
        .download(d.file_path);
      if (dErr || !blob) throw dErr ?? new Error("DOCUMENT_DOWNLOAD_FAILED");
      let text = "";
      let note: string | null = null;
      if (/pdf/i.test(d.file_type) || /\.pdf$/i.test(d.name)) {
        const { readPdfPages } = await import("@/lib/pdf-text");
        text = (await readPdfPages(await blob.arrayBuffer()).catch(() => [] as string[])).join(
          "\n",
        );
        if (!text.trim())
          note = "No readable text layer (scanned PDF). Upload a TXT/CSV transcription.";
      } else text = await blob.text();
      text = text.slice(0, MAX_TEXT);
      const docType = guessDocType(d.name, text);
      out.push({
        documentId: d.id,
        name: d.name,
        docType,
        note,
        invoice:
          docType === "carrier_invoice" || docType === "customer_invoice"
            ? parseInvoiceText(text)
            : null,
        releases:
          /\.csv$/i.test(d.name) || /csv/i.test(d.file_type) ? parseTerminalReleaseCsv(text) : [],
        notice:
          docType === "terminal_notice" || docType === "carrier_notice"
            ? parseNoticeEmail(text)
            : null,
        proposalOnly: true,
      });
    }
    return out;
  });

export const runManagedDd = createServerFn({ method: "POST" })
  .validator(
    z.object({
      caseId: z.string().uuid(),
      requestId: z.string().uuid(),
      facts: ddFacts,
      sender: z.object({
        companyName: z.string().trim().min(1).max(200),
        contactName: z.string().trim().min(1).max(200),
        contactEmail: z.string().trim().max(200).optional(),
        contactPhone: z.string().trim().max(60).optional(),
      }),
      sourceDocumentIds: z.array(z.string().uuid()).max(100).default([]),
    }),
  )
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    await requireIntegratedFeatureReady(context.supabase);
    assertInvestigator(context.role);
    const { data: caseRow, error: cErr } = await context.supabase
      .from("cases")
      .select("id")
      .eq("id", data.caseId)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (cErr) throw cErr;
    if (!caseRow) throw new Error("CASE_NOT_FOUND");
    const analysis = analyseDd(data.facts);
    const pack = buildDisputePack(data.facts, analysis, data.sender);
    const f = data.facts;
    const rows = pack.letters.map((l) => ({
      case_id: data.caseId,
      finding_type:
        l.party === "carrier_terminal" ? "avoidable_demurrage_detention" : "missed_billing",
      title:
        (l.party === "carrier_terminal" ? "Carrier/terminal credit: " : "Customer rebill: ") +
        f.containerNo,
      expected_amount: Math.round((analysis.invoicedAmount - l.amount) * 100) / 100,
      actual_amount: analysis.invoicedAmount,
      currency: analysis.currency,
      calculation: {
        kind: "dd_dispute",
        difference: l.amount,
        breakdown:
          l.days + " day(s) and " + analysis.currency + " " + l.amount.toFixed(2) + " claimable",
        dd: {
          party: l.party,
          claimAmount: l.amount,
          letter: l,
          timeline: pack.timeline,
          recommendedResponse: pack.recommendedResponse,
          evidenceIndex: pack.evidenceIndex,
          totals: analysis.totals,
          exceptions: analysis.exceptions,
          dayLines: analysis.dayLines,
          fallbackRebillAmount: analysis.fallbackRebillAmount,
          facts: f,
        },
      },
      source_document_ids: data.sourceDocumentIds,
      evidence_refs: data.sourceDocumentIds.map((id) => ({ kind: "document", id })),
    }));
    let created: { id: string; title: string; status: string }[] = [];
    if (rows.length) {
      const { data: c, error } = await context.supabase.rpc("cargoiq_create_recovery_batch", {
        p_tenant: context.tenantId,
        p_request: data.requestId,
        p_rows: JSON.parse(JSON.stringify(rows)),
      });
      if (error) throw error;
      created = (c ?? []).map((r: { id: string; title: string; status: string }) => ({
        id: r.id,
        title: r.title,
        status: r.status,
      }));
    }
    return { analysis, pack, created };
  });

async function loadFinding(context: { supabase: never; tenantId: string } & Json, id: string) {
  const supabase = context.supabase as unknown as {
    from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const { data, error } = await supabase
    .from("recovery_findings")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("FINDING_NOT_FOUND");
  return {
    supabase,
    row: data as { id: string; status: string; currency: string; calculation: unknown },
  };
}

async function saveFinding(
  supabase: { from: (t: string) => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  tenantId: string,
  userId: string,
  id: string,
  fromStatus: string,
  toStatus: string,
  calculation: Json,
) {
  const { data: updated, error } = await supabase
    .from("recovery_findings")
    .update({
      status: toStatus,
      calculation,
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .eq("status", fromStatus)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!updated) throw new Error("FINDING_CHANGED: reload before retrying");
  return updated;
}

export const recordClaimSent = createServerFn({ method: "POST" })
  .validator(
    z.object({
      findingId: z.string().uuid(),
      channel: z.enum(["email", "portal", "post", "phone"]),
      recipient: z.string().trim().min(1).max(300),
      reference: z.string().trim().max(120).optional(),
      sentAt: z.string().datetime(),
    }),
  )
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    await requireIntegratedFeatureReady(context.supabase);
    assertInvestigator(context.role);
    const { supabase, row } = await loadFinding(context as never, data.findingId);
    const calc = obj(row.calculation);
    const dd = obj(calc.dd);
    if (!dd.party) throw new Error("NOT_A_DD_FINDING");
    if (dd.track) throw new Error("CLAIM_ALREADY_RECORDED");
    if (row.status !== "approved")
      throw new Error("APPROVE_FINDING_FIRST: only an approved finding can be recorded as sent");
    assertValidTransition("approved", "submitted");
    const track = recordSent({
      party: dd.party as never,
      channel: data.channel,
      recipient: data.recipient,
      reference: data.reference,
      sentAt: data.sentAt,
      amountClaimed: Number(dd.claimAmount),
      currency: row.currency,
    });
    return saveFinding(
      supabase,
      context.tenantId,
      context.user.id,
      row.id,
      "approved",
      "submitted",
      {
        ...calc,
        dd: { ...dd, track },
      },
    );
  });

const eventInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("reminder_sent"),
    at: z.string().datetime(),
    note: z.string().max(1000).optional(),
  }),
  z.object({
    kind: z.literal("escalated"),
    at: z.string().datetime(),
    note: z.string().max(1000).optional(),
  }),
  z.object({
    kind: z.literal("response_received"),
    at: z.string().datetime(),
    note: z.string().max(1000).optional(),
  }),
  z.object({
    kind: z.literal("outcome"),
    at: z.string().datetime(),
    outcome: z.enum(["credited", "partial_credit", "rebilled_and_paid", "waived", "rejected"]),
    amount: z.number().positive().finite().optional(),
    evidence: z.string().trim().max(300).optional(),
    note: z.string().max(1000).optional(),
    confirmReceived: z.literal(true).optional(),
  }),
]);

export const recordClaimEvent = createServerFn({ method: "POST" })
  .validator(z.object({ findingId: z.string().uuid(), event: eventInput }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    await requireIntegratedFeatureReady(context.supabase);
    assertInvestigator(context.role);
    const { supabase, row } = await loadFinding(context as never, data.findingId);
    const calc = obj(row.calculation);
    const dd = obj(calc.dd);
    const track = dd.track as ClaimTrack | undefined;
    if (!track || row.status !== "submitted") throw new Error("CLAIM_NOT_SUBMITTED");
    const ev = data.event;
    if (ev.kind === "outcome" && ev.outcome !== "rejected" && ev.confirmReceived !== true)
      throw new Error(
        "RECOVERY_CONFIRMATION_REQUIRED: confirm the money or credit has actually been received",
      );
    const { confirmReceived: _c, ...clean } = ev as typeof ev & { confirmReceived?: true };
    void _c;
    const next = recordEvent(track, clean);
    const toStatus =
      ev.kind === "outcome" ? (ev.outcome === "rejected" ? "rejected" : "recovered") : "submitted";
    if (toStatus !== "submitted") assertValidTransition("submitted", toStatus);
    return saveFinding(supabase, context.tenantId, context.user.id, row.id, "submitted", toStatus, {
      ...calc,
      dd: { ...dd, track: next },
      ...(toStatus === "recovered"
        ? {
            recoveredConfirmation: {
              confirmed: true,
              actor: context.user.id,
              at: new Date().toISOString(),
            },
          }
        : {}),
    });
  });

export const getDdFollowUps = createServerFn({ method: "GET" })
  .validator(
    z.object({
      caseId: z.string().uuid().optional(),
      today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  )
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    await requireIntegratedFeatureReady(context.supabase);
    let q = context.supabase
      .from("recovery_findings")
      .select("id,title,case_id,status,currency,calculation")
      .eq("tenant_id", context.tenantId)
      .in("status", ["submitted"]);
    if (data.caseId) q = q.eq("case_id", data.caseId);
    const { data: rows, error } = await q;
    if (error) throw error;
    return (rows ?? []).flatMap((r) => {
      const track = obj(obj(r.calculation).dd).track as ClaimTrack | undefined;
      return track
        ? [{ findingId: r.id, title: r.title, track, next: nextAction(track, data.today) }]
        : [];
    });
  });

export const getRecoveryReport = createServerFn({ method: "GET" })
  .validator(
    z.object({
      caseId: z.string().uuid().optional(),
      successFeePercent: z.number().min(0).max(100).nullable().default(null),
    }),
  )
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    await requireIntegratedFeatureReady(context.supabase);
    let q = context.supabase
      .from("recovery_findings")
      .select("calculation,status")
      .eq("tenant_id", context.tenantId)
      .in("status", ["submitted", "recovered", "rejected"]);
    if (data.caseId) q = q.eq("case_id", data.caseId);
    const { data: rows, error } = await q;
    if (error) throw error;
    const tracks = (rows ?? []).flatMap((r) => {
      const t = obj(obj(r.calculation).dd).track as ClaimTrack | undefined;
      return t ? [t] : [];
    });
    const byCurrency = new Map<string, ClaimTrack[]>();
    for (const t of tracks) byCurrency.set(t.currency, [...(byCurrency.get(t.currency) ?? []), t]);
    return [...byCurrency.values()].map((ts) => buildRecoveryReport(ts, data.successFeePercent));
  });
