import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppHeader, Stat } from "@/components/ui-kit";
import { CASES, fmtMoney } from "@/lib/case-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CargoIQ — Investigations" },
      { name: "description", content: "Investigative evidence and dispute intelligence for freight, port and logistics disputes." },
      { property: "og:title", content: "CargoIQ — Investigations" },
      { property: "og:description", content: "Reconstruct what happened. Prove what can be proven. Calculate the money. Package the evidence." },
    ],
  }),
  component: Index,
});

const statusCls: Record<string, string> = {
  Investigating: "text-reported bg-reported/10",
  "In review": "text-derived bg-derived/10",
  Approved: "text-observed bg-observed/10",
  Recovery: "text-foreground bg-secondary",
};

function Index() {
  const [q, setQ] = useState("");
  const rows = CASES.filter((c) => (c.id + c.title + c.counterparty + c.type).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-[1400px] px-6 py-10">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Investigations</p>
        <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight md:text-4xl">
          What actually happened — and what can be defensibly proven.
        </h1>
        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Open cases" value={CASES.filter((c) => c.status !== "Recovery").length} />
          <Stat label="Contradictions" value={CASES.reduce((a, c) => a + c.contradictions, 0)} tone="disputed" />
          <Stat label="Exposure (USD)" value={fmtMoney(CASES.filter((c) => c.currency === "USD").reduce((a, c) => a + c.exposure, 0), "USD")} />
          <Stat label="Recoverable (USD)" value={fmtMoney(CASES.filter((c) => c.currency === "USD").reduce((a, c) => a + c.recovery, 0), "USD")} tone="observed" />
        </div>

        <div className="mt-10 flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Case register</h2>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cases, counterparties…"
            className="w-72 rounded-md border bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" />
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-panel text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Case</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Counterparty</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Charged</th>
                <th className="px-4 py-3 text-right font-medium">Recoverable</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-t bg-card transition-colors hover:bg-accent">
                  <td className="px-4 py-3">
                    <Link to="/cases/$caseId" params={{ caseId: c.id }} className="block">
                      <div className="font-mono text-xs text-muted-foreground">{c.id} · {c.port}</div>
                      <div className="font-medium">{c.title}</div>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.type}</td>
                  <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{c.counterparty}</td>
                  <td className="px-4 py-3"><span className={cn("rounded px-2 py-1 text-xs", statusCls[c.status])}>{c.status}</span></td>
                  <td className="px-4 py-3 text-right font-mono">{fmtMoney(c.exposure, c.currency)}</td>
                  <td className="px-4 py-3 text-right font-mono text-observed">{fmtMoney(c.recovery, c.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
