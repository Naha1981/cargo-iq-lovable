import { useCallback, useEffect, useState } from "react";
import { Panel, Button } from "@/components/ui-kit";
import {
  capturePortWeather,
  ingestRiskEvent,
  linkCostRecovery,
  listCaseRiskTimeline,
  updateAlertStatus,
  verifyRiskAlert,
} from "@/lib/risk-events.functions";
import { COST_CATEGORIES, VERIFICATION_DECISIONS } from "@/lib/risk-events";
import type { Database } from "@/integrations/supabase/types";

type RiskEventRow = Database["public"]["Tables"]["risk_events"]["Row"];
type LinkRow = Database["public"]["Tables"]["risk_event_case_links"]["Row"] & {
  risk_events?: RiskEventRow | null;
};
type AlertRow = Database["public"]["Tables"]["risk_alerts"]["Row"];
type CostRow = Database["public"]["Tables"]["cost_recovery_links"]["Row"];

const badge = (text: string, tone: string) => (
  <span key={text} className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${tone}`}>
    {text}
  </span>
);

const toneFor = (v: string) =>
  v === "confirmed" || v === "high" || v === "recovered"
    ? "bg-emerald-500/15 text-emerald-400"
    : v === "rejected" || v === "critical" || v === "not_recoverable"
      ? "bg-red-500/15 text-red-400"
      : v === "warning" || v === "medium" || v === "suspected" || v === "under_investigation"
        ? "bg-amber-500/15 text-amber-400"
        : "bg-slate-500/15 text-slate-400";

export function CaseIntelligence({
  caseId,
  portCode,
}: {
  caseId: string;
  portCode: string | null;
}) {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noticeTitle, setNoticeTitle] = useState("");
  const [noticeSummary, setNoticeSummary] = useState("");
  const [noticeRef, setNoticeRef] = useState("");
  const [costCategory, setCostCategory] = useState<string>(COST_CATEGORIES[0]);
  const [costAmount, setCostAmount] = useState("");

  const refresh = useCallback(async () => {
    const data = await listCaseRiskTimeline({ data: { caseId } });
    setLinks(data.links as LinkRow[]);
    setAlerts(data.alerts);
    setCosts(data.costs);
  }, [caseId]);

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

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

  const timeline = links
    .map((l) => ({ link: l, event: l.risk_events ?? null }))
    .filter((x) => x.event)
    .sort((a, b) => (a.event!.observed_at < b.event!.observed_at ? 1 : -1));

  return (
    <div className="space-y-4">
      <Panel title="Logistics risk intelligence">
        <p className="mb-2 text-xs text-muted-foreground">
          External signals linked to this case. Signals stay unverified until a person confirms or
          rejects them; every alert names its source, timestamp and confidence.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || !portCode}
            onClick={() =>
              run(async () => {
                if (!portCode) throw new Error("Set the case port first (ZADUR, ZACPT or ZARCB).");
                const r = await capturePortWeather({ data: { portCode } });
                if (!r.captured) setError(`Weather check: ${r.reason}`);
              })
            }
          >
            Check port weather now
          </Button>
        </div>
        {error ? <p className="mt-2 text-xs text-red-400">{error}</p> : null}
      </Panel>

      <Panel title="Record a port notice or incident">
        <p className="mb-2 text-xs text-muted-foreground">
          Paste a notice from a port authority, terminal operator or public report. It is stored
          with its source and timestamp, then matched to this and other cases.
        </p>
        <div className="grid gap-2">
          <input
            className="w-full min-w-0 rounded border border-border bg-background px-2 py-1 text-sm"
            placeholder="Notice title (e.g. Durban container terminal gate congestion)"
            value={noticeTitle}
            onChange={(e) => setNoticeTitle(e.target.value)}
          />
          <textarea
            className="w-full min-w-0 rounded border border-border bg-background px-2 py-1 text-sm"
            placeholder="Summary of what is reported"
            rows={2}
            value={noticeSummary}
            onChange={(e) => setNoticeSummary(e.target.value)}
          />
          <input
            className="w-full min-w-0 rounded border border-border bg-background px-2 py-1 text-sm"
            placeholder="Source reference (URL or document name)"
            value={noticeRef}
            onChange={(e) => setNoticeRef(e.target.value)}
          />
          <div>
            <Button
              disabled={busy || noticeTitle.trim().length < 3}
              onClick={() =>
                run(async () => {
                  await ingestRiskEvent({
                    data: {
                      source: "manual_notice",
                      kind: "port_notice",
                      title: noticeTitle.trim(),
                      summary: noticeSummary.trim() || null,
                      observedAt: new Date().toISOString(),
                      portCode: portCode ?? null,
                      confidence: "low",
                      sourceRef: noticeRef.trim() || null,
                    },
                  });
                  setNoticeTitle("");
                  setNoticeSummary("");
                  setNoticeRef("");
                })
              }
            >
              Record notice
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title="Risk alerts">
        <p className="mb-2 text-xs text-muted-foreground">
          Each alert explains the risk, its evidence, confidence, likely impact and a recommended
          next action. Confirm or reject it to build the audit trail.
        </p>
        {alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No alerts for this case yet.</p>
        ) : (
          <ul className="space-y-3">
            {alerts.map((a) => (
              <li key={a.id} className="rounded border border-border p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {badge(a.severity, toneFor(a.severity))}
                  {badge(a.status, toneFor(a.status))}
                  {badge(`confidence: ${a.confidence}`, toneFor(a.confidence))}
                  {badge(a.verification_status, toneFor(a.verification_status))}
                </div>
                <p className="mt-1.5 text-sm font-medium">{a.headline}</p>
                <p className="mt-1 text-xs text-muted-foreground">{a.risk_explanation}</p>
                <p className="mt-1 text-xs text-muted-foreground">Evidence: {a.evidence_summary}</p>
                {a.likely_impact ? <p className="mt-1 text-xs">Impact: {a.likely_impact}</p> : null}
                {a.recommended_action ? (
                  <p className="mt-1 text-xs">Next: {a.recommended_action}</p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {a.verification_status !== "confirmed" ? (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          verifyRiskAlert({
                            data: { alertId: a.id, decision: VERIFICATION_DECISIONS[0] },
                          }),
                        )
                      }
                    >
                      Confirm
                    </Button>
                  ) : null}
                  {a.verification_status !== "rejected" ? (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          verifyRiskAlert({
                            data: { alertId: a.id, decision: VERIFICATION_DECISIONS[1] },
                          }),
                        )
                      }
                    >
                      Reject
                    </Button>
                  ) : null}
                  {a.status === "open" ? (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          updateAlertStatus({ data: { alertId: a.id, status: "acknowledged" } }),
                        )
                      }
                    >
                      Acknowledge
                    </Button>
                  ) : null}
                  {a.status === "open" || a.status === "acknowledged" ? (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          updateAlertStatus({ data: { alertId: a.id, status: "resolved" } }),
                        )
                      }
                    >
                      Resolve
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Incident timeline">
        <p className="mb-2 text-xs text-muted-foreground">
          Linked events for this case, newest first. Confirmed events are marked; everything else is
          a signal awaiting verification.
        </p>
        {timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No linked events yet. Check port weather or record a notice above.
          </p>
        ) : (
          <ul className="space-y-2">
            {timeline.map(({ link, event }) => (
              <li
                key={link.id}
                className="flex items-start gap-3 rounded border border-border p-2.5"
              >
                <span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                  {new Date(event!.observed_at).toLocaleString()}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {badge(event!.kind, toneFor(event!.kind))}
                    {badge(event!.verification_status, toneFor(event!.verification_status))}
                    <span className="text-sm">{event!.title}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {link.rationale} Source: {event!.source}
                    {event!.source_ref ? ` (${event!.source_ref})` : ""}.
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Cost recovery">
        <p className="mb-2 text-xs text-muted-foreground">
          Link confirmed or suspected disruptions to recoverable costs. The evidence trail above
          supports each claim.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="w-full min-w-0 rounded border border-border bg-background px-2 py-1 text-sm"
            value={costCategory}
            onChange={(e) => setCostCategory(e.target.value)}
          >
            {COST_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <input
            className="w-32 rounded border border-border bg-background px-2 py-1 text-sm"
            placeholder="Amount (ZAR)"
            inputMode="decimal"
            value={costAmount}
            onChange={(e) => setCostAmount(e.target.value)}
          />
          <Button
            disabled={busy || alerts.length === 0}
            onClick={() =>
              run(async () => {
                const amount = costAmount.trim() ? Number(costAmount) : null;
                if (amount != null && !Number.isFinite(amount)) throw new Error("Invalid amount");
                await linkCostRecovery({
                  data: {
                    caseId,
                    alertId: alerts[0]?.id ?? null,
                    costCategory: costCategory as (typeof COST_CATEGORIES)[number],
                    amount,
                    currency: "ZAR",
                  },
                });
                setCostAmount("");
              })
            }
          >
            Link cost to latest alert
          </Button>
        </div>
        {costs.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No cost links yet.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {costs.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-2 rounded border border-border px-2.5 py-1.5 text-sm"
              >
                {badge(c.status, toneFor(c.status))}
                <span className="capitalize">{c.cost_category.replace(/_/g, " ")}</span>
                <span className="font-mono text-xs">
                  {c.amount != null
                    ? `${c.currency} ${Number(c.amount).toLocaleString()}`
                    : "amount not set"}
                </span>
                {c.evidence_ref ? (
                  <span className="text-xs text-muted-foreground">Evidence: {c.evidence_ref}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
