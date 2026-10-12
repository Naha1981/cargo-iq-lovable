import { createFileRoute, Link, Outlet, notFound, redirect } from "@tanstack/react-router";
import { AppHeader } from "@/components/ui-kit";
import { getCurrentUser } from "@/lib/auth.functions";
import { getCase } from "@/lib/case.functions";

export const Route = createFileRoute("/cases/$caseId")({
  ssr: false,
  beforeLoad: async () => {
    const session = await getCurrentUser();
    if (!session.user) throw redirect({ to: "/auth" });
  },
  loader: async ({ params }) => {
    const c = await getCase({ data: { caseId: params.caseId } });
    if (!c) throw notFound();
    return c;
  },
  head: ({ loaderData }) => ({ meta: loaderData ? [{ title: loaderData.reference_no + " | CargoIQ" }] : [{ title: "Case | CargoIQ" }] }),
  notFoundComponent: () => <div className="p-10 text-center">Case not found. <Link to="/" className="text-primary">Back</Link></div>,
  component: CaseLayout,
});

const tabs = [
  { to: "/cases/$caseId", label: "Timeline", exact: true },
  { to: "/cases/$caseId/map", label: "God's Eye View" },
  { to: "/cases/$caseId/documents", label: "Documents & Contradictions" },
  // CCTV stays off the demo navigation until server encryption is configured.
  { to: "/cases/$caseId/financials", label: "Financials" },
  { to: "/cases/$caseId/pack", label: "Evidence Pack" },
] as const;

function CaseLayout() {
  const c = Route.useLoaderData();

  return (
    <div className="min-h-screen">
      <AppHeader />
      <div className="border-b bg-panel">
        <div className="mx-auto max-w-[1400px] px-6 pt-6">
          <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">← All cases</Link>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="font-mono text-xs text-primary">{c.reference_no} · {c.port_code ?? "—"} · {c.status}</div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">{c.vessel_name || "Unnamed vessel"} {c.voyage_no ? "· " + c.voyage_no : ""}</h1>
              <p className="text-sm text-muted-foreground">{c.container_no ? "Container " + c.container_no : "Multiple containers"} · Opened {new Date(c.created_at).toLocaleDateString("en-GB")}</p>
            </div>
          </div>

          <nav className="mt-5 flex gap-1 overflow-x-auto">
            {tabs.map((t) => (
              <Link
                key={t.to}
                to={t.to}
                params={{ caseId: c.id }}
                activeOptions={{ exact: "exact" in t }}
                className="whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground"
                activeProps={{ className: "!border-primary !text-foreground" }}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <main className="mx-auto max-w-[1400px] px-6 py-8"><Outlet /></main>
    </div>
  );
}

