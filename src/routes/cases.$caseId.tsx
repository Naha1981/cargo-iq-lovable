import { createFileRoute, Link, Outlet, notFound } from "@tanstack/react-router";
import { AppHeader } from "@/components/ui-kit";
import { getCase, fmtMoney } from "@/lib/case-data";

export const Route = createFileRoute("/cases/$caseId")({
  loader: ({ params }) => {
    const c = getCase(params.caseId);
    if (!c) throw notFound();
    return c;
  },
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.id} — ${loaderData.title} | CargoIQ` },
          { name: "description", content: `${loaderData.type} investigation against ${loaderData.counterparty}.` },
          { property: "og:title", content: `${loaderData.id} | CargoIQ` },
          { property: "og:description", content: loaderData.title },
        ]
      : [{ title: "Case not found | CargoIQ" }, { name: "robots", content: "noindex" }],
  }),
  notFoundComponent: () => (
    <div className="p-10 text-center">Case not found. <Link to="/" className="text-primary">Back</Link></div>
  ),
  component: CaseLayout,
});

const tabs = [
  { to: "/cases/$caseId", label: "Timeline", exact: true },
  { to: "/cases/$caseId/map", label: "God's Eye View" },
  { to: "/cases/$caseId/documents", label: "Documents & Contradictions" },
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
              <div className="font-mono text-xs text-primary">{c.id} · {c.type} · {c.port}</div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">{c.title}</h1>
              <p className="text-sm text-muted-foreground">Counterparty: {c.counterparty} · Opened {c.opened}</p>
            </div>
            <div className="flex gap-6 font-mono text-sm">
              <div><div className="text-[10px] uppercase tracking-widest text-muted-foreground">Charged</div>{fmtMoney(c.exposure, c.currency)}</div>
              <div><div className="text-[10px] uppercase tracking-widest text-muted-foreground">Recoverable</div><span className="text-observed">{fmtMoney(c.recovery, c.currency)}</span></div>
            </div>
          </div>
          <nav className="mt-5 flex gap-1 overflow-x-auto">
            {tabs.map((t) => (
              <Link key={t.to} to={t.to} params={{ caseId: c.id }} activeOptions={{ exact: "exact" in t }}
                className="whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground"
                activeProps={{ className: "!border-primary !text-foreground" }}>
                {t.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      <main className="mx-auto max-w-[1400px] px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
