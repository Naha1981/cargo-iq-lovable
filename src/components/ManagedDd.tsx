import { useCallback, useEffect, useMemo, useState } from "react";
import { Panel, Button } from "@/components/ui-kit";
import {
  DELAY_CAUSES,
  DOC_TYPES,
  analyseDd,
  ddFacts,
  type DdFacts,
  type DocType,
} from "@/lib/dd-analysis";
import { buildDisputePack, mailtoLink, type DisputeLetter } from "@/lib/dd-dispute";
import { guessDocType, parseNoticeEmail } from "@/lib/dd-ingest";
import type { ClaimTrack, NextAction, RecoveryReport } from "@/lib/dd-followup";
import {
  getDdFollowUps,
  getRecoveryReport,
  ingestDdEvidence,
  recordClaimEvent,
  recordClaimSent,
  runManagedDd,
} from "@/lib/dd.functions";
import { listRecoveryFindings, updateRecoveryStatus } from "@/lib/revenue-recovery.functions";
import { recoveryRequestKey, clearRecoveryRequest } from "@/lib/recovery-request";
import type { Database } from "@/integrations/supabase/types";

type FindingRow = Database["public"]["Tables"]["recovery_findings"]["Row"];
const inputCls = "w-full rounded border bg-background px-2 py-1.5 text-sm";
const money = (n: number, c: string) =>
  c + " " + n.toLocaleString("en-ZA", { minimumFractionDigits: 2 });
const LABEL: Record<string, string> = {
  disputable_with_carrier_terminal: "Disputable with carrier / terminal",
  recoverable_from_customer: "Recoverable from customer",
  avoidable_next_time: "Avoidable next time",
  correctly_payable: "Correctly payable",
};
const today = () => new Date().toISOString().slice(0, 10);

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function ManagedDd({
  caseId,
  documents = [],
}: {
  caseId: string;
  documents?: { id: string; name: string }[];
}) {
  const [docTypes, setDocTypes] = useState<Record<string, DocType>>(() =>
    Object.fromEntries(documents.map((d) => [d.id, guessDocType(d.name)])),
  );
  const [picked, setPicked] = useState<string[]>([]);
  const [proposals, setProposals] = useState<Awaited<ReturnType<typeof ingestDdEvidence>>>([]);
  const [pasted, setPasted] = useState("");
  const [f, setF] = useState({
    containerNo: "",
    carrier: "",
    terminal: "",
    dischargeDate: "",
    freeDays: "",
    gateOutDate: "",
    units: "1",
    rate: "",
    invoices: "",
    events: "",
    billed: "",
    clause: "",
    company: "",
    contact: "",
    email: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [findings, setFindings] = useState<FindingRow[]>([]);
  const [follow, setFollow] = useState<
    { findingId: string; title: string; track: ClaimTrack; next: NextAction }[]
  >([]);
  const [reports, setReports] = useState<RecoveryReport[]>([]);
  const [feePct, setFeePct] = useState("");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  const refresh = useCallback(async () => {
    const rows = (await listRecoveryFindings({ data: { caseId } })) as FindingRow[];
    setFindings(rows.filter((r) => (r.calculation as { dd?: unknown } | null)?.dd));
    setFollow((await getDdFollowUps({ data: { caseId, today: today() } })) as never);
    setReports(
      (await getRecoveryReport({
        data: { caseId, successFeePercent: feePct === "" ? null : Number(feePct) },
      })) as never,
    );
  }, [caseId, feePct]);
  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  // One invoice per line: number | type | days | amount. Events: from | to | cause | description | source
  const facts = useMemo((): { facts?: DdFacts; problem?: string } => {
    try {
      const invoices = f.invoices
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [invoiceNo, chargeType, days, amount] = l.split("|").map((s) => s.trim());
          return {
            invoiceNo,
            chargeType: chargeType || "demurrage",
            days: days ? Number(days) : undefined,
            amount: Number(amount),
          };
        });
      const delayEvents = f.events
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [from, to, cause, description, source] = l.split("|").map((s) => s.trim());
          return { from, to, cause, description, source };
        });
      const parsed = ddFacts.parse({
        containerNo: f.containerNo,
        carrier: f.carrier,
        terminal: f.terminal,
        dischargeDate: f.dischargeDate,
        freeDays: Number(f.freeDays),
        gateOutDate: f.gateOutDate,
        units: Number(f.units || 1),
        rateTiers: [{ fromDay: 1, dailyRate: Number(f.rate) }],
        invoices,
        delayEvents,
        customerBilledAmount: f.billed === "" ? null : Number(f.billed),
        contractClause: f.clause.trim() || undefined,
        documentsPresent: [
          ...new Set(picked.length ? picked.map((id) => docTypes[id]) : Object.values(docTypes)),
        ].filter((t) => t !== "other"),
      });
      return { facts: parsed };
    } catch (e) {
      return {
        problem:
          e instanceof Error
            ? e.name === "ZodError"
              ? "Fill in all required fields"
              : e.message
            : String(e),
      };
    }
  }, [f, picked, docTypes]);

  const preview = useMemo(() => {
    if (!facts.facts) return null;
    try {
      const a = analyseDd(facts.facts);
      return {
        a,
        pack: buildDisputePack(facts.facts, a, {
          companyName: f.company || "[Your company]",
          contactName: f.contact || "[Your name]",
          contactEmail: f.email || undefined,
        }),
      };
    } catch {
      return null;
    }
  }, [facts, f.company, f.contact, f.email]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const applyProposal = (p: (typeof proposals)[number]) => {
    setF((s) => {
      const n = { ...s };
      const inv = p.invoice;
      if (inv) {
        if (inv.containerNos[0] && !n.containerNo) n.containerNo = inv.containerNos[0];
        if (inv.invoiceNo && inv.total != null)
          n.invoices +=
            (n.invoices ? "\n" : "") +
            [inv.invoiceNo, inv.chargeType, inv.days ?? "", inv.total].join(" | ");
      }
      for (const r of p.releases)
        if (r.gateOutDate && !n.gateOutDate) {
          n.gateOutDate = r.gateOutDate;
          n.containerNo ||= r.containerNo;
        }
      if (p.notice?.delayWindow && p.notice.proposedCause)
        n.events +=
          (n.events ? "\n" : "") +
          [
            p.notice.delayWindow.from,
            p.notice.delayWindow.to,
            p.notice.proposedCause,
            p.notice.subject ?? "Notice",
            p.name,
          ].join(" | ");
      return n;
    });
  };

  const addPasted = () => {
    const n = parseNoticeEmail(pasted);
    if (!n.delayWindow || !n.proposedCause) {
      setError("No delay cause and dates recognised in that email. Add the event by hand.");
      return;
    }
    setF((s) => ({
      ...s,
      events:
        s.events +
        (s.events ? "\n" : "") +
        [
          n.delayWindow!.from,
          n.delayWindow!.to,
          n.proposedCause,
          n.subject ?? "Pasted notice",
          "pasted email " + (n.sentOn ?? ""),
        ].join(" | "),
    }));
    setPasted("");
  };

  const letterBlock = (l: DisputeLetter) => (
    <div key={l.party} className="space-y-2 rounded border p-3">
      <div className="flex items-center justify-between text-sm font-medium">
        <span>
          {l.party === "carrier_terminal"
            ? "Credit request to carrier / terminal"
            : "Customer rebill"}
          : {l.amount.toFixed(2)}
        </span>
        <span
          className={
            "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase " +
            (l.readyToSend
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-amber-500/15 text-amber-400")
          }
        >
          {l.readyToSend ? "Ready to send" : "Not ready"}
        </span>
      </div>
      {l.blockers.map((b) => (
        <p key={b} className="text-xs text-amber-400">
          {b}
        </p>
      ))}
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">
        {l.body}
      </pre>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => navigator.clipboard.writeText(l.body)}>Copy letter</Button>
        <Button
          onClick={() =>
            download("dispute-" + l.party + ".txt", "Subject: " + l.subject + "\n\n" + l.body)
          }
        >
          Download
        </Button>
        <a className="rounded border px-3 py-1.5 text-sm" href={mailtoLink(l)}>
          Open in email app
        </a>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <Panel title="Managed D&D dispute">
        <p className="mb-4 text-xs text-muted-foreground">
          Read the evidence, flag exceptions, classify every chargeable day, prepare the claim
          letter, then track the claim to a confirmed outcome. You send the letter yourself: nothing
          is submitted externally from here. Extracted values are proposals; check them before
          running.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">1. Evidence</h3>
            <fieldset className="space-y-1 rounded border p-2 text-xs">
              <legend>Case documents (tag type, tick to read)</legend>
              {documents.length === 0 && (
                <p className="text-muted-foreground">
                  Upload invoices, notices and release records on the Documents tab first.
                </p>
              )}
              {documents.map((d) => (
                <div key={d.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={picked.includes(d.id)}
                    onChange={(e) =>
                      setPicked((p) =>
                        e.target.checked ? [...p, d.id] : p.filter((x) => x !== d.id),
                      )
                    }
                  />
                  <span className="flex-1 truncate">{d.name}</span>
                  <select
                    aria-label={"Type of " + d.name}
                    className="rounded border bg-background px-1 py-0.5"
                    value={docTypes[d.id] ?? "other"}
                    onChange={(e) =>
                      setDocTypes((t) => ({ ...t, [d.id]: e.target.value as DocType }))
                    }
                  >
                    {DOC_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </fieldset>
            <Button
              disabled={busy || picked.length === 0}
              onClick={() =>
                run(async () =>
                  setProposals(await ingestDdEvidence({ data: { caseId, documentIds: picked } })),
                )
              }
            >
              Read selected documents
            </Button>
            {proposals.map((p) => (
              <div key={p.documentId} className="rounded border p-2 text-xs">
                <div className="flex justify-between">
                  <b>{p.name}</b>
                  <span>{p.docType.replace(/_/g, " ")}</span>
                </div>
                {p.note && <p className="text-amber-400">{p.note}</p>}
                {p.invoice && (
                  <p>
                    Invoice {p.invoice.invoiceNo ?? "?"}: total {p.invoice.total ?? "?"},{" "}
                    {p.invoice.lines.length} line(s), containers{" "}
                    {p.invoice.containerNos.join(", ") || "none found"}
                  </p>
                )}
                {p.releases.map((r) => (
                  <p key={r.containerNo}>
                    Release {r.containerNo}: gate-out {r.gateOutDate ?? "?"}
                  </p>
                ))}
                {p.notice && (
                  <p>
                    Notice: cause {p.notice.proposedCause ?? "not recognised"}, window{" "}
                    {p.notice.delayWindow
                      ? p.notice.delayWindow.from + " to " + p.notice.delayWindow.to
                      : "not found"}
                  </p>
                )}
                <Button onClick={() => applyProposal(p)}>Use these values</Button>
              </div>
            ))}
            <textarea
              className={inputCls + " font-mono text-xs"}
              rows={4}
              placeholder="Or paste a terminal / carrier notice email here"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <Button disabled={!pasted.trim()} onClick={addPasted}>
              Add delay event from email
            </Button>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">2. Facts to check</h3>
            <div className="grid grid-cols-2 gap-2">
              <input
                className={inputCls}
                placeholder="Container no."
                value={f.containerNo}
                onChange={set("containerNo")}
              />
              <input
                className={inputCls}
                placeholder="Carrier"
                value={f.carrier}
                onChange={set("carrier")}
              />
              <input
                className={inputCls}
                placeholder="Terminal"
                value={f.terminal}
                onChange={set("terminal")}
              />
              <input
                className={inputCls}
                placeholder="Units (containers)"
                value={f.units}
                onChange={set("units")}
              />
              <label className="text-xs">
                Discharge date
                <input
                  type="date"
                  className={inputCls}
                  value={f.dischargeDate}
                  onChange={set("dischargeDate")}
                />
              </label>
              <label className="text-xs">
                Gate-out date
                <input
                  type="date"
                  className={inputCls}
                  value={f.gateOutDate}
                  onChange={set("gateOutDate")}
                />
              </label>
              <input
                className={inputCls}
                placeholder="Free days"
                value={f.freeDays}
                onChange={set("freeDays")}
              />
              <input
                className={inputCls}
                placeholder="Daily rate (per unit)"
                value={f.rate}
                onChange={set("rate")}
              />
            </div>
            <textarea
              className={inputCls + " font-mono text-xs"}
              rows={3}
              placeholder={
                "Carrier invoices: number | type | days | amount\nINV-1001 | demurrage | 5 | 18500"
              }
              value={f.invoices}
              onChange={set("invoices")}
            />
            <textarea
              className={inputCls + " font-mono text-xs"}
              rows={3}
              placeholder={
                "Delay events: from | to | cause | description | source\n2026-03-04 | 2026-03-08 | terminal | Gate outage | notice.txt\nCauses: " +
                DELAY_CAUSES.join(", ")
              }
              value={f.events}
              onChange={set("events")}
            />
            <input
              className={inputCls}
              placeholder="Billed to customer so far (leave blank if unknown)"
              value={f.billed}
              onChange={set("billed")}
            />
            <textarea
              className={inputCls}
              rows={2}
              placeholder="Contract or tariff clause that supports the claim (quote it; leave blank if you do not have it)"
              value={f.clause}
              onChange={set("clause")}
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                className={inputCls}
                placeholder="Your company"
                value={f.company}
                onChange={set("company")}
              />
              <input
                className={inputCls}
                placeholder="Your name"
                value={f.contact}
                onChange={set("contact")}
              />
              <input
                className={inputCls}
                placeholder="Your email"
                value={f.email}
                onChange={set("email")}
              />
            </div>
            {facts.problem && <p className="text-xs text-muted-foreground">{facts.problem}</p>}
          </div>
        </div>
      </Panel>

      {preview && (
        <Panel title="3. Exceptions and classification">
          <p className="mb-2 text-sm">
            Free time expires {preview.a.freeTimeExpiresOn}. {preview.a.chargeableDays} chargeable
            day(s) = {money(preview.a.calculatedAmount, preview.a.currency)} calculated vs{" "}
            {money(preview.a.invoicedAmount, preview.a.currency)} invoiced.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1 text-sm">
              {preview.a.totals.map((t) => (
                <div
                  key={t.classification}
                  className="flex justify-between border-b border-muted pb-1"
                >
                  <span>{LABEL[t.classification]}</span>
                  <span>
                    {t.days} day(s) · {money(t.amount, preview.a.currency)}
                  </span>
                </div>
              ))}
              {preview.a.exceptions.map((e, i) => (
                <p key={i} className="text-xs text-amber-400">
                  {e.code.replace(/_/g, " ")}: {e.message}
                </p>
              ))}
            </div>
            <div className="max-h-56 overflow-auto text-xs">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th>Date</th>
                    <th>Class</th>
                    <th>Why</th>
                    <th className="text-right">Amt</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.a.dayLines.map((d) => (
                    <tr key={d.date}>
                      <td>{d.date}</td>
                      <td>{LABEL[d.classification].split(" ")[0]}</td>
                      <td>
                        {d.cause ?? "none"}
                        {d.source ? " (" + d.source + ")" : ""}
                      </td>
                      <td className="text-right">{d.amount.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <h4 className="mb-1 mt-4 text-xs font-semibold uppercase text-muted-foreground">
            4. Dispute pack
          </h4>
          <p className="mb-2 text-sm">{preview.pack.recommendedResponse}</p>
          <div className="space-y-3">{preview.pack.letters.map(letterBlock)}</div>
          <div className="mt-3">
            <Button
              disabled={
                busy ||
                !facts.facts ||
                !f.company ||
                !f.contact ||
                preview.pack.letters.length === 0 ||
                saved
              }
              onClick={() =>
                run(async () => {
                  const payload = {
                    caseId,
                    facts: facts.facts,
                    company: f.company,
                    contact: f.contact,
                    source: picked,
                  };
                  const requestId = await recoveryRequestKey(sessionStorage, caseId, payload);
                  await runManagedDd({
                    data: {
                      caseId,
                      requestId,
                      facts: facts.facts!,
                      sender: {
                        companyName: f.company,
                        contactName: f.contact,
                        contactEmail: f.email || undefined,
                      },
                      sourceDocumentIds: picked,
                    },
                  });
                  await clearRecoveryRequest(sessionStorage, caseId, payload);
                  setSaved(true);
                })
              }
            >
              Save claim(s) to this case
            </Button>
            {(!f.company || !f.contact) && (
              <span className="ml-2 text-xs text-muted-foreground">
                Add your company and name to save.
              </span>
            )}
          </div>
        </Panel>
      )}

      {findings.length > 0 && (
        <Panel title="5. Claims and follow-up">
          <div className="space-y-3">
            {findings.map((r) => {
              const dd = (
                r.calculation as unknown as {
                  dd: {
                    party: string;
                    claimAmount: number;
                    letter: DisputeLetter;
                    track?: ClaimTrack;
                  };
                }
              ).dd;
              const fu = follow.find((x) => x.findingId === r.id);
              return (
                <div key={r.id} className="space-y-2 rounded border p-3 text-sm">
                  <div className="flex justify-between">
                    <b>{r.title}</b>
                    <span className="text-xs uppercase">{r.status}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Claim {money(dd.claimAmount, r.currency)}
                    {dd.letter.readyToSend
                      ? ""
                      : " · letter not ready: " + dd.letter.blockers.join(" ")}
                  </p>
                  {r.status === "new" && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await updateRecoveryStatus({
                            data: { findingId: r.id, to: "under_review" },
                          });
                        })
                      }
                    >
                      Start review
                    </Button>
                  )}
                  {r.status === "under_review" && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await updateRecoveryStatus({ data: { findingId: r.id, to: "approved" } });
                        })
                      }
                    >
                      Approve claim
                    </Button>
                  )}
                  {r.status === "approved" && (
                    <SentForm
                      busy={busy}
                      onSubmit={(v) =>
                        run(async () => {
                          await recordClaimSent({
                            data: { findingId: r.id, ...v, sentAt: new Date().toISOString() },
                          });
                        })
                      }
                    />
                  )}
                  {r.status === "submitted" && fu && (
                    <div className="space-y-2">
                      <p className="text-xs">
                        Sent {fu.track.sentAt.slice(0, 10)} to {fu.track.recipient}. Next:{" "}
                        <b>{fu.next.action.replace(/_/g, " ")}</b>
                        {"dueOn" in fu.next ? " (reply due " + fu.next.dueOn + ")" : ""}
                      </p>
                      <ul className="text-xs text-muted-foreground">
                        {fu.track.events.map((e, i) => (
                          <li key={i}>
                            {e.at.slice(0, 10)} {e.kind.replace(/_/g, " ")}
                            {e.note ? ": " + e.note : ""}
                          </li>
                        ))}
                      </ul>
                      <div className="flex flex-wrap gap-2">
                        {(["reminder_sent", "escalated", "response_received"] as const).map((k) => (
                          <Button
                            key={k}
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                await recordClaimEvent({
                                  data: {
                                    findingId: r.id,
                                    event: { kind: k, at: new Date().toISOString() },
                                  },
                                });
                              })
                            }
                          >
                            Log: {k.replace(/_/g, " ")}
                          </Button>
                        ))}
                      </div>
                      <OutcomeForm
                        busy={busy}
                        max={fu.track.amountClaimed}
                        onSubmit={(ev) =>
                          run(async () => {
                            await recordClaimEvent({
                              data: { findingId: r.id, event: ev as never },
                            });
                          })
                        }
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <Panel title="6. Net recovery report">
        <p className="mb-2 text-xs text-muted-foreground">
          Counts only money confirmed received with a credit note or payment reference. Open claims
          are pending, never recovered.
        </p>
        <label className="mb-3 block text-xs">
          Success fee % (optional)
          <input
            className={inputCls + " mt-1 w-32"}
            value={feePct}
            onChange={(e) => setFeePct(e.target.value)}
          />
        </label>
        {reports.length === 0 && (
          <p className="text-sm text-muted-foreground">No submitted claims yet.</p>
        )}
        {reports.map((r) => (
          <div key={r.currency} className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Claimed</span>
              <span>{money(r.claimed, r.currency)}</span>
            </div>
            <div className="flex justify-between">
              <b>Confirmed recovered</b>
              <b>{money(r.confirmedRecovered, r.currency)}</b>
            </div>
            <div className="flex justify-between">
              <span>Pending ({r.openClaims} open)</span>
              <span>{money(r.openAmount, r.currency)}</span>
            </div>
            <div className="flex justify-between">
              <span>Rejected</span>
              <span>{money(r.rejected, r.currency)}</span>
            </div>
            {r.successFee != null && (
              <div className="flex justify-between">
                <span>Success fee ({r.successFeePercent}%)</span>
                <span>{money(r.successFee, r.currency)}</span>
              </div>
            )}
            {r.netToClient != null && (
              <div className="flex justify-between">
                <span>Net to client</span>
                <span>{money(r.netToClient, r.currency)}</span>
              </div>
            )}
            <Button
              onClick={() =>
                download(
                  "recovery-report.txt",
                  [
                    "Net recovery report (" + r.currency + ")",
                    ...r.claims.map(
                      (c) =>
                        (c.reference ?? "-") +
                        " | " +
                        c.party +
                        " | claimed " +
                        c.claimed +
                        " | recovered " +
                        c.recovered +
                        " | " +
                        c.status,
                    ),
                    "Confirmed recovered: " + r.confirmedRecovered,
                    "Pending: " + r.openAmount,
                  ].join("\n"),
                )
              }
            >
              Download report
            </Button>
          </div>
        ))}
      </Panel>

      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function SentForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (v: {
    channel: "email" | "portal" | "post" | "phone";
    recipient: string;
    reference?: string;
  }) => void;
}) {
  const [channel, setChannel] = useState<"email" | "portal" | "post" | "phone">("email");
  const [recipient, setRecipient] = useState("");
  const [reference, setReference] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2 text-xs">
      <select
        aria-label="Channel"
        className="rounded border bg-background px-2 py-1.5"
        value={channel}
        onChange={(e) => setChannel(e.target.value as never)}
      >
        {["email", "portal", "post", "phone"].map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <input
        className="rounded border bg-background px-2 py-1.5"
        placeholder="Sent to (address or contact)"
        value={recipient}
        onChange={(e) => setRecipient(e.target.value)}
      />
      <input
        className="rounded border bg-background px-2 py-1.5"
        placeholder="Their reference (optional)"
        value={reference}
        onChange={(e) => setReference(e.target.value)}
      />
      <Button
        disabled={busy || !recipient.trim()}
        onClick={() =>
          onSubmit({
            channel,
            recipient: recipient.trim(),
            reference: reference.trim() || undefined,
          })
        }
      >
        I sent it
      </Button>
    </div>
  );
}

function OutcomeForm({
  busy,
  max,
  onSubmit,
}: {
  busy: boolean;
  max: number;
  onSubmit: (e: Record<string, unknown>) => void;
}) {
  const [outcome, setOutcome] = useState("credited");
  const [amount, setAmount] = useState("");
  const [evidence, setEvidence] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2 text-xs">
      <select
        aria-label="Outcome"
        className="rounded border bg-background px-2 py-1.5"
        value={outcome}
        onChange={(e) => setOutcome(e.target.value)}
      >
        {["credited", "partial_credit", "rebilled_and_paid", "waived", "rejected"].map((o) => (
          <option key={o} value={o}>
            {o.replace(/_/g, " ")}
          </option>
        ))}
      </select>
      {outcome !== "rejected" && (
        <>
          <input
            className="rounded border bg-background px-2 py-1.5"
            placeholder={"Amount confirmed (max " + max + ")"}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <input
            className="rounded border bg-background px-2 py-1.5"
            placeholder="Credit note / payment ref"
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
          />
        </>
      )}
      <Button
        disabled={busy}
        onClick={() => {
          if (
            outcome !== "rejected" &&
            !window.confirm("Confirm this money or credit has actually been received?")
          )
            return;
          onSubmit({
            kind: "outcome",
            at: new Date().toISOString(),
            outcome,
            ...(outcome !== "rejected"
              ? { amount: Number(amount), evidence, confirmReceived: true }
              : {}),
          });
        }}
      >
        Record outcome
      </Button>
    </div>
  );
}
