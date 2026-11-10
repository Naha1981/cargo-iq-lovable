import { useEffect, useState } from "react";
import {
  createFileRoute,
  Link,
  Outlet,
  notFound,
  redirect,
  useRouterState,
  useNavigate,
} from "@tanstack/react-router";
import { AppHeader, DisputeBadge } from "@/components/ui-kit";
import { isSeededSampleCase } from "@/lib/sample-case";
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
  { to: "/cases/$caseId/intelligence", label: "Intelligence" },
  { to: "/cases/$caseId/simulation", label: "Simulation Lab" },
  { to: "/cases/$caseId/corridor", label: "Corridor" },
  { to: "/cases/$caseId/scene", label: "3D Scene" },
  { to: "/cases/$caseId/geospatial", label: "Geospatial" },
  { to: "/cases/$caseId/gaps", label: "Gaps" },
  // CCTV stays off the demo navigation until server encryption is configured.
  { to: "/cases/$caseId/financials", label: "Financials" },
  { to: "/cases/$caseId/recovery", label: "Revenue Recovery" },
  { to: "/cases/$caseId/pack", label: "Evidence Pack" },
] as const;

function CaseLayout() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const mapPage = /\/(map|live-harbour)$/.test(pathname);
  const section = pathname.split("/")[3] ?? "";
  const groups = [
    { name: "Overview", pages: ["", "appointments", "kpis", "intelligence", "gaps"] },
    {
      name: "Documents & evidence",
      pages: ["documents", "definitions", "counts", "imports", "clocks", "matches"],
    },
    {
      name: "Maps",
      pages: ["map", "live-harbour", "simulation", "corridor", "scene", "geospatial"],
    },
    { name: "Money", pages: ["financials", "recovery"] },
    { name: "Evidence pack", pages: ["pack"] },
  ];
  const activeGroup = groups.findIndex((g) => g.pages.includes(section));
  const [chosenGroup, setChosenGroup] = useState(activeGroup < 0 ? 0 : activeGroup);
  useEffect(() => {
    setChosenGroup(activeGroup < 0 ? 0 : activeGroup);
  }, [activeGroup]);
  const shownTabs = tabs.filter((t) =>
    groups[chosenGroup].pages.includes(t.to.split("/")[3] ?? ""),
  );
  const c = data.case;
  const openDisputes = data.contradictions.filter((x) => x.status === "FLAGGED").length;

  return (
    <div className="min-h-screen">
      <AppHeader />
      {isSeededSampleCase(c) && (
        <p
          role="note"
          className="border-b bg-amber-50 p-4 text-center font-semibold text-amber-900"
        >
          SAMPLE ONLY - this case contains fictional demonstration data, not customer evidence.
        </p>
      )}
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

          <nav aria-label="Investigation pages" className="mt-4 pb-2">
            <div className="grid grid-cols-2 gap-2 pb-2 sm:hidden">
              <label className="text-xs text-muted-foreground">
                Category
                <select
                  aria-label="Page group"
                  value={chosenGroup}
                  onChange={(e) => setChosenGroup(Number(e.target.value))}
                  className="mt-1 min-h-11 w-full rounded border bg-card p-2 text-sm text-foreground"
                >
                  {groups.map((g, i) => (
                    <option key={g.name} value={i}>
                      {i === 1 ? "Documents" : g.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-muted-foreground">
                Page
                <select
                  aria-label="Investigation page"
                  value={
                    shownTabs.some((t) => (t.to.split("/")[3] ?? "") === section)
                      ? section
                      : "choose"
                  }
                  onChange={(e) => {
                    const tab = shownTabs.find(
                      (t) => (t.to.split("/")[3] ?? "") === e.target.value,
                    );
                    if (tab) void navigate({ to: tab.to, params: { caseId: c.id } });
                  }}
                  className="mt-1 min-h-11 w-full rounded border bg-card p-2 text-sm text-foreground"
                >
                  <option value="choose" disabled>
                    Choose a page
                  </option>
                  {shownTabs.map((t) => (
                    <option key={t.to} value={t.to.split("/")[3] ?? ""}>
                      {(
                        {
                          documents: "Documents",
                          counts: "Counts",
                          imports: "Imports",
                          recovery: "Recovery",
                          geospatial: "Geospatial",
                          simulation: "Simulation",
                          map: "Harbour map",
                          "live-harbour": "Live harbour",
                        } as Record<string, string>
                      )[t.to.split("/")[3] ?? ""] ?? t.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div aria-label="Page groups" className="hidden gap-2 pb-2 sm:flex sm:flex-wrap">
              {groups.map((g, i) => (
                <button
                  key={g.name}
                  type="button"
                  aria-pressed={chosenGroup === i}
                  onClick={() => setChosenGroup(i)}
                  className={
                    "min-h-11 rounded-lg border px-3 text-sm font-medium " +
                    (chosenGroup === i
                      ? "border-primary bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {g.name}
                </button>
              ))}
            </div>
            <div
              className="hidden flex-wrap gap-1 sm:flex"
              aria-label={groups[chosenGroup].name + " pages"}
            >
              {shownTabs.map((t) => (
                <Link
                  key={t.to}
                  preload="intent"
                  to={t.to}
                  params={{ caseId: c.id }}
                  activeOptions={{ exact: "exact" in t }}
                  className="min-h-11 rounded border-b-2 border-transparent px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground"
                  activeProps={{ className: "!border-primary !text-foreground" }}
                >
                  {t.label}
                </Link>
              ))}
              {chosenGroup === 2 && (
                <a
                  href="https://canvas.nahalabs.co.za/#/t/cargoiq"
                  target="_blank"
                  rel="noopener"
                  className="min-h-11 rounded px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground"
                >
                  Case map ↗
                </a>
              )}
            </div>
            {chosenGroup === 2 && (
              <a
                href="https://canvas.nahalabs.co.za/#/t/cargoiq"
                target="_blank"
                rel="noopener"
                className="inline-flex min-h-11 items-center text-sm text-muted-foreground sm:hidden"
              >
                Case map ↗
              </a>
            )}
          </nav>
        </div>
      </div>

      <main
        className={
          mapPage ? "mx-auto w-full px-2 py-3 sm:px-4" : "mx-auto max-w-[1400px] px-6 py-8"
        }
      >
        <Outlet />
      </main>
    </div>
  );
}
