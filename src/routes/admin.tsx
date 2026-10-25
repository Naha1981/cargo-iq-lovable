import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getPlatformAdminMore, getPlatformAdminOverview } from "@/lib/admin.functions";
import type { AdminOverview, AdminPage } from "@/lib/admin.functions";

// Owner-only platform overview. Authorization is enforced in the database functions;
// any failure renders the same plain not-found state as a missing route. Lists are
// keyset-paged: every section shows "loaded of total" and a Load more control while a
// next cursor exists, so the owner can reach every workspace, user, case and dispute.
export const Route = createFileRoute("/admin")({ component: AdminPage });

type Section = "tenants" | "users" | "cases" | "disputes";

function AdminPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["platform-admin-overview"],
    queryFn: () => getPlatformAdminOverview({ data: {} }),
    retry: false,
    staleTime: 60_000,
  });
  const [extra, setExtra] = useState<Partial<Record<Section, AdminPage<any>[]>>>({});
  const [loadingMore, setLoadingMore] = useState<Section | null>(null);

  if (isLoading) return <main className="mx-auto max-w-3xl px-6 py-16 text-muted-foreground">Loading…</main>;
  if (isError || !data) return <main className="mx-auto max-w-3xl px-6 py-16"><h1 className="text-xl font-semibold">Page not found</h1><p className="mt-2 text-sm text-muted-foreground">The page you're looking for doesn't exist or has been moved.</p></main>;

  const loadMore = async (section: Section, cursor: string) => {
    setLoadingMore(section);
    try {
      const page = await getPlatformAdminMore({ data: { section, cursor } });
      setExtra((e) => ({ ...e, [section]: [...(e[section] ?? []), page] }));
    } finally { setLoadingMore(null); }
  };
  return <AdminOverviewView data={data} extra={extra} loadingMore={loadingMore} onLoadMore={loadMore} />;
}

export function AdminOverviewView({ data, extra = {}, loadingMore = null, onLoadMore }: {
  data: AdminOverview;
  extra?: Partial<Record<Section, AdminPage<any>[]>>;
  loadingMore?: Section | null;
  onLoadMore?: (section: Section, cursor: string) => void;
}) {
  const pages = <T,>(section: Section, first: AdminPage<T>) => [first, ...((extra[section] ?? []) as AdminPage<T>[])];
  const rows = <T,>(section: Section, first: AdminPage<T>): T[] => pages(section, first).flatMap((p) => p.rows);
  const lastCursor = (section: Section, first: AdminPage<any>) => { const ps = pages(section, first); return ps[ps.length - 1].next_cursor; };

  const tenants = rows("tenants", data.tenants);
  const users = rows("users", data.users);
  const cases = rows("cases", data.cases);
  const disputes = rows("disputes", data.disputes);
  const tenantName = new Map(tenants.map((t) => [t.id, t.name]));

  const moreButton = (section: Section, first: AdminPage<any>) => {
    const cursor = lastCursor(section, first);
    if (!cursor) return null;
    return (
      <button
        onClick={() => onLoadMore?.(section, cursor)}
        disabled={loadingMore === section}
        className="mt-3 min-h-11 w-full rounded-xl border border-border px-4 text-sm text-muted-foreground"
      >
        {loadingMore === section ? "Loading…" : "Load more"}
      </button>
    );
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Platform overview</h1>
      <p className="mt-1 text-sm text-muted-foreground">All businesses, users, cases and open disputes. Visible only to you.</p>

      <section className="mt-8">
        <h2 className="text-base font-medium">Businesses ({tenants.length} of {data.tenants.total})</h2>
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
          {tenants.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-4 px-4 py-3 min-h-11">
              <span className="font-medium">{t.name}</span>
              <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">{t.users} users · {t.cases} cases</span>
            </li>
          ))}
        </ul>
        {moreButton("tenants", data.tenants)}
      </section>

      <section className="mt-8">
        <h2 className="text-base font-medium">Users ({users.length} of {data.users.total})</h2>
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
          {users.map((u) => (
            <li key={u.tenant_id + u.user_id} className="px-4 py-3 min-h-11 sm:flex sm:items-center sm:justify-between sm:gap-4">
              <span className="text-sm font-medium">{u.display}{u.email && u.display !== u.email ? <span className="block text-xs font-normal text-muted-foreground">{u.email}</span> : null}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground sm:mt-0 sm:shrink-0 sm:text-sm">{tenantName.get(u.tenant_id) ?? u.tenant_id} · {u.role}</span>
            </li>
          ))}
        </ul>
        {moreButton("users", data.users)}
      </section>

      <section className="mt-8">
        <h2 className="text-base font-medium">Cases ({cases.length} of {data.cases.total}, newest first)</h2>
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
          {cases.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-4 px-4 py-3 min-h-11">
              <span className="text-sm">{c.title} <span className="text-muted-foreground">· {tenantName.get(c.tenant_id) ?? ""}</span></span>
              {c.open_disputes > 0
                ? <span className="shrink-0 whitespace-nowrap rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">{c.open_disputes} open dispute{c.open_disputes === 1 ? "" : "s"}</span>
                : <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">no open disputes</span>}
            </li>
          ))}
        </ul>
        {moreButton("cases", data.cases)}
      </section>

      <section className="mt-8">
        <h2 className="text-base font-medium">Open disputes to review ({disputes.length} of {data.disputes.total})</h2>
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
          {disputes.map((d) => (
            <li key={d.id} className="px-4 py-3 min-h-11 text-sm">
              <Link to="/admin/disputes/$disputeId" params={{ disputeId: d.id }} className="block">
                <span className="font-medium">{d.case_title ?? "Untitled case"}</span>
                {d.summary ? <span className="mt-0.5 block text-muted-foreground">{d.summary}</span> : null}
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {d.source_documents?.length ? "Source: " + d.source_documents.join(" · ") + " · " : ""}{d.status.toLowerCase()} · {new Date(d.created_at).toLocaleDateString()}
                </span>
              </Link>
            </li>
          ))}
          {!disputes.length && <li className="px-4 py-3 text-sm text-muted-foreground">Nothing waiting for review.</li>}
        </ul>
        {moreButton("disputes", data.disputes)}
      </section>
    </main>
  );
}
