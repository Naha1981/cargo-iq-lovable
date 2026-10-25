import { CargoIqOffer } from "@/components/CargoIqOffer";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppHeader, Stat } from "@/components/ui-kit";
import { getCurrentUser } from "@/lib/auth.functions";
import { getCaseDashboardStats, getCaseRegisterPage } from "@/lib/case.functions";

type RegisterRow = Awaited<ReturnType<typeof getCaseRegisterPage>>["rows"][number];
import { fmtMoney } from "@/lib/case-data";
import { cn } from "@/lib/utils";
import { SiteFooter } from "@/components/SiteFooter";

const PAGE_SIZE = 100;

export const Route = createFileRoute("/")({
  ssr: false,
  loader: async () => {
    const session = await getCurrentUser();
    if (!session.user) return { session, stats: null, page: null };
    const [stats, page] = await Promise.all([
      getCaseDashboardStats(),
      getCaseRegisterPage({ data: { limit: PAGE_SIZE } }),
    ]);
    return { session, stats, page };
  },
  head: () => ({
    meta: [
      { title: "CargoIQ — Investigations" },
      {
        name: "description",
        content:
          "Investigative evidence and dispute intelligence for freight, port and logistics disputes.",
      },
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
  const { session, stats, page } = Route.useLoaderData();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<RegisterRow[]>(page?.rows ?? []);
  const [cursor, setCursor] = useState<{ created_at: string; id: string } | null>(
    page?.nextCursor ?? null,
  );
  const [loading, setLoading] = useState(false);
  const firstLoad = useRef(true);
  // Monotonic request sequence: any response that is not the latest request
  // (stale search or a load-more superseded by a new search) is discarded.
  const reqSeq = useRef(0);

  // Server-side search over the same four fields as the old client filter,
  // debounced; resets paging to the first page of the filtered result.
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    const seq = ++reqSeq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const p = await getCaseRegisterPage({ data: { q, limit: PAGE_SIZE } });
        if (seq !== reqSeq.current) return; // a newer search superseded this one
        setRows(p.rows);
        setCursor(p.nextCursor);
      } finally {
        if (seq === reqSeq.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const loadMore = async () => {
    if (!cursor || loading) return;
    const seq = reqSeq.current;
    setLoading(true);
    try {
      const p = await getCaseRegisterPage({ data: { q, cursor, limit: PAGE_SIZE } });
      if (seq !== reqSeq.current) return; // search changed while paging; discard
      setRows((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...p.rows.filter((r) => !seen.has(r.id))];
      });
      setCursor(p.nextCursor);
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  };

  if (!session.user) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader public />
        <main>
          <CargoIqOffer />
        </main>
      </div>
    );
  }

  const noCases = (stats?.total ?? 0) === 0;

  return (
    <div className="min-h-screen">
      <AppHeader />
      {noCases && <CargoIqOffer firstRun />}
      <main className="mx-auto max-w-[1400px] px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">
              Investigations
            </p>
            {noCases ? (
              <h2 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight md:text-4xl">
                What actually happened — and what can be defensibly proven.
              </h2>
            ) : (
              <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight md:text-4xl">
                What actually happened — and what can be defensibly proven.
              </h1>
            )}
          </div>
          <Link
            to="/new-case"
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            + New investigation
          </Link>
        </div>

        <a
          href="/demo/cuf"
          className="mt-6 inline-flex rounded-md border px-4 py-2 text-sm font-semibold"
        >
          Explore a worked example
        </a>
        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Open cases" value={stats?.openCases ?? 0} />
          <Stat label="Contradictions" value={stats?.contradictions ?? 0} tone="disputed" />
          <Stat
            label="Exposure (ZAR)"
            value={fmtMoney(stats?.exposureZar ?? 0, "ZAR")}
            className="col-span-2 md:col-span-1"
          />
          <Stat
            label="Recoverable (ZAR)"
            value={stats?.recoveryBlocked ? "BLOCKED" : fmtMoney(stats?.recoveryZar ?? 0, "ZAR")}
            tone={stats?.recoveryBlocked ? "disputed" : "observed"}
            className="col-span-2 md:col-span-1"
          />
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Case register
          </h2>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search reference, vessel, container…"
            className="w-full sm:w-72 rounded-md border bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
          />
        </div>

        <div className="mt-3 overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[600px] text-sm">
            <thead className="bg-panel text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Case</th>
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
                      <div className="font-mono text-xs text-muted-foreground">
                        {c.reference_no} · {c.port_code ?? "—"}
                      </div>
                      <div className="font-medium">
                        {c.vessel_name || "Unnamed vessel"} {c.voyage_no ? "· " + c.voyage_no : ""}
                      </div>
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded px-2 py-1 text-xs",
                        statusCls[c.status] ?? "bg-secondary",
                      )}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    {fmtMoney(c.exposure, c.currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-observed">
                    {c.contradictions > 0 || c.clockConflicts
                      ? "BLOCKED"
                      : fmtMoney(c.recovery ?? 0, c.currency)}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No investigations yet. Create the first case to begin.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {cursor && (
          <div className="mt-4 text-center">
            <button
              onClick={loadMore}
              disabled={loading}
              className="rounded-md border px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {loading ? "Loading…" : "Load more investigations"}
            </button>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
