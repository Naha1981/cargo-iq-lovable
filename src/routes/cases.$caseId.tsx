import { createFileRoute, Link, Outlet, notFound, redirect } from "@tanstack/react-router";
import { AppHeader, DisputeBadge } from "@/components/ui-kit";
import { getCaseWorkspace } from "@/lib/case.functions";

export const Route = createFileRoute("/cases/$caseId")({
  ssr: false,
  // Router-owned, browser-local snapshot. No shared server cache or skipped tenant checks.
  staleTime: 30_000,
  preloadStaleTime: 30_000,
  loader: async ({ params }) => {
    let data;
    try {
      data = await getCaseWorkspace({ data: { caseId: params.caseId } });
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNAUTHENTICATED"))
        throw redirect({ to: "/auth" });
      throw error;
    }
    if (!data.case) throw notFound();
    // The notFound guard above establishes case as present for every consumer.
    return { ...data, case: data.case };
  },
  pendingMs: 150,
  pendingMinMs: 0,
  pendingComponent: () => (
    <div role="status" className="p-10 text-sm text-muted-foreground">
      Loading investigation...
    </div>
  ),
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [{ title: loaderData.case.reference_no + " | CargoIQ" }]
      : [{ title: "Case | CargoIQ" }],
  }),
  notFoundComponent: () => (
    <div className="p-10 text-center">
      Case not found.{" "}
      <Link to="/" className="text-primary">
        Back
      </Link>
    </div>
  ),
  component: CaseLayout,
});

const tabs = [
  { to: "/cases/$caseId", label: "Timeline", exact: true },
  { to: "/cases/$caseId/map", label: "Harbour Map" },
  { to: "/cases/$caseId/live-harbour", label: "Live Harbour View" },
  { to: "/cases/$caseId/documents", label: "Documents & Contradictions" },
  { to: "/cases/$caseId/definitions", label: "Definitions" },
  { to: "/cases/$caseId/counts", label: "Count reconciliation" },
  { to: "/cases/$caseId/imports", label: "Authorised imports" },
  { to: "/cases/$caseId/clocks", label: "Clocks" },
  { to: "/cases/$caseId/appointments", label: "Appointments" },
  { to: "/cases/$caseId/kpis", label: "KPIs" },
  { to: "/cases/$caseId/matches", label: "Matches" },
  { to: "/cases/$caseId/gaps", label: "Gaps" },
  // CCTV stays off the demo navigation until server encryption is configured.
  { to: "/cases/$caseId/financials", label: "Financials" },
  { to: "/cases/$caseId/pack", label: "Evidence Pack" },
] as const;

function CaseLayout() {
  const data = Route.useLoaderData();
  const c = data.case;
  const openDisputes = data.contradictions.filter((x) => x.status === "FLAGGED").length;

  return (
    <div className="min-h-screen">
      <AppHeader />
      <div className="border-b bg-panel">
        <div className="mx-auto max-w-[1400px] px-6 pt-6">
          <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
            ← All cases
          </Link>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="font-mono text-xs text-primary">
                {c.reference_no} · {c.port_code ?? "—"} · {c.status}
              </div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                {c.vessel_name || "Unnamed vessel"} {c.voyage_no ? "· " + c.voyage_no : ""}
              </h1>
              <p className="text-sm text-muted-foreground">
                {c.container_no ? "Container " + c.container_no : "Multiple containers"} · Opened{" "}
                {new Date(c.created_at).toLocaleDateString("en-GB")}
              </p>
              {openDisputes > 0 && (
                <Link
                  to="/cases/$caseId/documents"
                  params={{ caseId: c.id }}
                  className="mt-2 inline-block"
                  aria-label="Open the disputed items"
                >
                  <DisputeBadge
                    label={
                      openDisputes + " open dispute" + (openDisputes === 1 ? "" : "s") + " · review"
                    }
                  />
                </Link>
              )}
            </div>
          </div>

          <nav
            aria-label="Investigation pages"
            className="mt-5 grid grid-cols-2 gap-1 pb-2 sm:flex sm:flex-wrap sm:pb-0"
          >
            {tabs.map((t) => (
              <Link
                key={t.to}
                preload="intent"
                to={t.to}
                params={{ caseId: c.id }}
                activeOptions={{ exact: "exact" in t }}
                className="rounded-sm border-b-2 border-transparent px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground sm:whitespace-nowrap"
                activeProps={{ className: "!border-primary !text-foreground" }}
              >
                {t.label}
              </Link>
            ))}
            <a
              href="https://canvas.nahalabs.co.za/#/t/cargoiq"
              target="_blank"
              rel="noopener"
              className="rounded-sm border-b-2 border-transparent px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground sm:whitespace-nowrap"
            >
              Case map ↗
            </a>
          </nav>
        </div>
      </div>

      <main className="mx-auto max-w-[1400px] px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
