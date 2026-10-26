import { useCallback, useEffect, useState } from "react";
import { Panel, Button } from "@/components/ui-kit";
import {
  getRecoveryFinding,
  assignRecoveryFinding,
  listRecoveryOwners,
  listRecoveryFindings,
  runInvoiceComparison,
  updateRecoveryStatus,
} from "@/lib/revenue-recovery.functions";
import { RECOVERY_STATUSES, type RecoveryStatus } from "@/lib/revenue-recovery";
import { recoveryRequestKey, clearRecoveryRequest } from "@/lib/recovery-request";
import type { Database } from "@/integrations/supabase/types";

type FindingRow = Database["public"]["Tables"]["recovery_findings"]["Row"];
type AuditRow = Database["public"]["Tables"]["recovery_finding_events"]["Row"];

const toneFor = (s: string) =>
  s === "recovered"
    ? "bg-emerald-500/15 text-emerald-400"
    : s === "rejected"
      ? "bg-red-500/15 text-red-400"
      : s === "new"
        ? "bg-amber-500/15 text-amber-400"
        : "bg-slate-500/15 text-slate-400";

const NEXT: Record<string, { to: RecoveryStatus; label: string; confirm?: boolean }[]> = {
  new: [
    { to: "under_review", label: "Start review" },
    { to: "rejected", label: "Reject" },
  ],
  under_review: [
    { to: "approved", label: "Approve claim" },
    { to: "rejected", label: "Reject" },
  ],
  approved: [
    { to: "submitted", label: "Mark submitted" },
    { to: "rejected", label: "Reject" },
  ],
  submitted: [
    { to: "recovered", label: "Confirm recovered (money received)", confirm: true },
    { to: "rejected", label: "Reject" },
  ],
  rejected: [],
  recovered: [],
};

export function RevenueRecovery({
  caseId,
  documents = [],
}: {
  caseId: string;
  documents?: { id: string; name: string }[];
}) {
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [findings, setFindings] = useState<FindingRow[]>([]);
  const [selected, setSelected] = useState<FindingRow | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [owners, setOwners] = useState<{ user_id: string; role: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [expectedText, setExpectedText] = useState("");
  const [actualText, setActualText] = useState("");

  const refresh = useCallback(async () => {
    const rows = await listRecoveryFindings({ data: { caseId } });
    setFindings(rows as FindingRow[]);
  }, [caseId]);

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
    listRecoveryOwners()
      .then(setOwners)
      .catch((e: Error) => setError(e.message));
  }, [refresh]);

  const open = async (id: string) => {
    const data = await getRecoveryFinding({ data: { findingId: id } });
    setSelected(data.finding as FindingRow);
    setAudit(data.history as AuditRow[]);
  };

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

  // One line per row: description | quantity | unit price
  const parseLines = (text: string) =>
    text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [description, q, p] = l.split("|").map((s) => s.trim());
        return { description, quantity: Number(q), unitPrice: Number(p), currency: "ZAR" };
      });

  return (
    <div className="space-y-6">
      <Panel title="Revenue Recovery">
        <p className="mb-4 text-xs text-muted-foreground">
          Reviewable detection of financial leakage. Statuses: new → under review → approved →
          submitted → recovered. An amount is marked recovered only after the money is confirmed
          received. Nothing is submitted externally from here.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Compare invoice vs expected charges</h3>
            <input
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              placeholder="Comparison title (e.g. MSC invoice INV-4412 vs rate card)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              className="w-full rounded border bg-background px-2 py-1.5 font-mono text-xs"
              rows={4}
              placeholder={
                "Expected charges, one per line: description | qty | unit price\nTHC | 1 | 2500.00"
              }
              value={expectedText}
              onChange={(e) => setExpectedText(e.target.value)}
            />
            <textarea
              className="w-full rounded border bg-background px-2 py-1.5 font-mono text-xs"
              rows={4}
              placeholder={
                "Actual invoice lines, one per line: description | qty | unit price\nTHC | 1 | 2900.00"
              }
              value={actualText}
              onChange={(e) => setActualText(e.target.value)}
            />
            <fieldset className="space-y-1 rounded border p-2 text-xs">
              <legend>Supporting case documents</legend>
              {documents.length === 0 && (
                <p className="text-muted-foreground">
                  No uploaded documents. Comparison is manually entered and unverified.
                </p>
              )}
              {documents.map((d) => (
                <label className="block" key={d.id}>
                  <input
                    type="checkbox"
                    checked={sourceIds.includes(d.id)}
                    onChange={(e) =>
                      setSourceIds((ids) =>
                        e.target.checked ? [...ids, d.id] : ids.filter((id) => id !== d.id),
                      )
                    }
                  />{" "}
                  {d.name}
                </label>
              ))}
              <p className="text-muted-foreground">
                Selecting a document links the source; it does not verify the entered figures or
                contractual entitlement.
              </p>
            </fieldset>
            <Button
              disabled={busy || !title.trim() || !expectedText.trim() || !actualText.trim()}
              onClick={() =>
                run(async () => {
                  const payload = {
                    caseId,
                    title: title.trim(),
                    expected: parseLines(expectedText),
                    actual: parseLines(actualText),
                    sourceDocumentIds: sourceIds,
                  };
                  const requestId = await recoveryRequestKey(sessionStorage, caseId, payload);
                  const res = await runInvoiceComparison({
                    data: {
                      caseId,
                      requestId,
                      title: title.trim(),
                      expected: parseLines(expectedText),
                      actual: parseLines(actualText),
                      sourceDocumentIds: sourceIds,
                    },
                  });
                  await clearRecoveryRequest(sessionStorage, caseId, payload);
                  if (res.created.length === 0)
                    setError("No discrepancies found between the two line sets.");
                })
              }
            >
              Run comparison
            </Button>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Findings ({findings.length})</h3>
            {findings.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No recovery findings for this case yet. Run a comparison above.
              </p>
            )}
            {findings.map((f) => (
              <button
                key={f.id}
                onClick={() => open(f.id).catch((e) => setError(e.message))}
                className="block w-full rounded border px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{f.title}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${toneFor(f.status)}`}
                  >
                    {f.status}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {f.finding_type} · expected {f.expected_amount ?? "—"} vs actual{" "}
                  {f.actual_amount ?? "—"} {f.currency} ·{" "}
                  {new Date(f.created_at).toLocaleDateString("en-GB")}
                </div>
              </button>
            ))}
          </div>
        </div>
      </Panel>

      {selected && (
        <Panel title={"Finding: " + selected.title}>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="mb-3 space-y-1 text-xs">
                <p>Case: {caseId}</p>
                <p>
                  Source documents:{" "}
                  {selected.source_document_ids.length === 0
                    ? "not recorded - manual comparison only"
                    : ""}
                </p>
                {selected.source_document_ids.map((id) => (
                  <a
                    key={id}
                    className="block text-primary underline"
                    href={`/cases/${caseId}/documents`}
                  >
                    {documents.find((d) => d.id === id)?.name ?? id}
                  </a>
                ))}
                <p>Potential discrepancy only. Approval is not an actual recovery.</p>
              </div>
              <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                Calculation breakdown
              </h4>
              <pre className="overflow-auto rounded bg-muted p-3 text-xs">
                {JSON.stringify(selected.calculation, null, 2)}
              </pre>
            </div>
            <div className="space-y-3">
              <label className="block text-sm">
                Assigned owner
                <select
                  aria-label="Assigned owner"
                  className="mt-1 block w-full rounded border bg-background p-2"
                  value={selected.assigned_to ?? ""}
                  disabled={busy}
                  onChange={(e) =>
                    run(async () => {
                      await assignRecoveryFinding({
                        data: { findingId: selected.id, assignee: e.target.value || null },
                      });
                      await open(selected.id);
                    })
                  }
                >
                  <option value="">Unassigned</option>
                  {owners.map((o) => (
                    <option key={o.user_id} value={o.user_id}>
                      {o.user_id} ({o.role})
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs text-muted-foreground">
                Workspace member IDs are shown because no verified display-name directory is
                available.
              </p>
              <div className="flex flex-wrap gap-2">
                {(NEXT[selected.status] ?? []).map((n) => (
                  <Button
                    key={n.to}
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        if (
                          n.confirm &&
                          !window.confirm(
                            "Confirm the recovered amount has actually been received?",
                          )
                        )
                          return;
                        await updateRecoveryStatus({
                          data: {
                            findingId: selected.id,
                            to: n.to,
                            confirmRecovered: n.confirm ? true : undefined,
                          } as never,
                        });
                        await open(selected.id);
                      })
                    }
                  >
                    {n.label}
                  </Button>
                ))}
                {(NEXT[selected.status] ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Terminal status: {selected.status}. No further transitions.
                  </p>
                )}
              </div>
            </div>
          </div>
        </Panel>
      )}

      {selected && audit.length > 0 && (
        <Panel title="Finding audit trail">
          <ul className="space-y-1 text-xs">
            {audit.map((a, i) => (
              <li key={i} className="flex justify-between border-b border-muted pb-1">
                <span className="font-mono">{a.action}</span>
                <span className="text-muted-foreground">
                  {new Date(a.created_at).toLocaleString("en-GB")} · {a.actor ?? "system"}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
