import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppHeader, Stat } from "@/components/ui-kit";
import { getCurrentUser } from "@/lib/auth.functions";
import { listCases } from "@/lib/case.functions";
import { fmtMoney } from "@/lib/case-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  ssr: false,
  loader: async () => {
    const session = await getCurrentUser();
    if (!session.user) return { session, cases: [] };
    return { session, cases: await listCases() };
  },
  head: () => ({
    meta: [
      { title: "CargoIQ — Investigations" },
      { name: "description", content: "Investigative evidence and dispute intelligence for freight, port and logistics disputes." },
    ],
  }),
  component: Index,
});

const statusCls: Record<string, string> = {
  INVESTIGATING: "text-reported bg-reported/10",
  IN_REVIEW: "text-derived bg-derived/10",
  APPROVED: "text-observed bg-observed/10",
  RECOVERY: "text-foreground bg-secondary",
  CLOSED: "text-muted-foreground bg-secondary",
};

function Index() {
  const { session, cases } = Route.useLoaderData();
  const [q, setQ] = useState("");
  const rows = useMemo(
    () => cases.filter((c: any) =>
      (c.reference_no + (c.vessel_name ?? "") + (c.container_no ?? "") + (c.port_code ?? ""))
        .toLowerCase()
        .includes(q.toLowerCase())
    ),
    [cases, q],
  );

  const zar = cases.filter((c: any) => c.currency === "ZAR");
  const charged = zar.reduce((sum: number, c: any) => sum + c.exposure, 0);
  const recoveryBlocked = zar.some((c: any) => c.contradictions > 0);
  const recovery = zar.reduce((sum: number, c: any) => sum + (c.recovery ?? 0), 0);

  if (!session.user) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader />
        <main className="mx-auto max-w-[1100px] px-6 py-20">
          <div className="max-w-3xl">
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Evidence & Dispute Intelligence</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-6xl">Reconstruct what happened. Prove what can be proven.</h1>
            <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
              CargoIQ joins freight documents, vessel movements, satellite observations, weather context and deterministic commercial rules into a human-reviewed investigation.
            </p>
            <Link to="/auth" className="mt-8 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Enter CargoIQ</Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-[1400px] px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Investigations</p>
            <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight md:text-4xl">What actually happened — and what can be defensibly proven.</h1>
          </div>
          <Link to="/new-case" className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">+ New investigation</Link>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Open cases" value={cases.filter((c: any) => c.status !== "CLOSED").length} />
          <Stat label="Contradictions" value={cases.reduce((a: number, c: any) => a + c.contradictions, 0)} tone="disputed" />
          <Stat label="Exposure (ZAR)" value={fmtMoney(charged, "ZAR")} />
          <Stat label="Recoverable (ZAR)" value={recoveryBlocked ? "BLOCKED" : fmtMoney(recovery, "ZAR")} tone={recoveryBlocked ? "disputed" : "observed"} />
        </div>

        <div className="mt-10 flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">Case register</h2>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search reference, vessel, container…"
            className="w-72 rounded-md border bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="mt-3 overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-panel text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Case</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Charged</th>
                <th className="px-4 py-3 text-right font-medium">Recoverable</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c: any) => (
                <tr key={c.id} className="border-t bg-card transition-colors hover:bg-accent">
                  <td className="px-4 py-3">
                    <Link to="/cases/$caseId" params={{ caseId: c.id }} className="block">
                      <div className="font-mono text-xs text-muted-foreground">{c.reference_no} · {c.port_code ?? "—"}</div>
                      <div className="font-medium">{c.vessel_name || "Unnamed vessel"} {c.voyage_no ? "· " + c.voyage_no : ""}</div>
                    </Link>
                  </td>
                  <td className="px-4 py-3"><span className={cn("rounded px-2 py-1 text-xs", statusCls[c.status] ?? "bg-secondary")}>{c.status}</span></td>
                  <td className="px-4 py-3 text-right font-mono">{fmtMoney(c.exposure, c.currency)}</td>
                  <td className="px-4 py-3 text-right font-mono text-observed">{c.contradictions > 0 ? "BLOCKED" : fmtMoney(c.recovery ?? 0, c.currency)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">No investigations yet. Create the first case to begin.</td></tr>}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

