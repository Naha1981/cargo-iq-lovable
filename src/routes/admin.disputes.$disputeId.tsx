import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getPlatformAdminDispute } from "@/lib/admin.functions";

// Owner-only dispute drilldown. Same opaque not-found failure as /admin; the database
// function enforces owner membership on every call.
export const Route = createFileRoute("/admin/disputes/$disputeId")({ component: DisputePage });

function DisputePage() {
  const { disputeId } = Route.useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["platform-admin-dispute", disputeId],
    queryFn: () => getPlatformAdminDispute({ data: { id: disputeId } }),
    retry: false,
    staleTime: 60_000,
  });
  if (isLoading)
    return <main className="mx-auto max-w-3xl px-6 py-16 text-muted-foreground">Loading…</main>;
  if (isError || !data)
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
      </main>
    );
  return <AdminDisputeView data={data} />;
}

import type { AdminDisputeDetail } from "@/lib/admin.functions";
export function AdminDisputeView({ data }: { data: AdminDisputeDetail }) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link to="/admin" className="text-sm text-muted-foreground">
        ← Platform overview
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {data.case_title ?? "Untitled case"}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Dispute · {data.status.toLowerCase()} since {new Date(data.created_at).toLocaleString()}
      </p>
      <section className="mt-8 space-y-4">
        <div className="rounded-xl border border-border p-4">
          <h2 className="text-sm font-medium text-muted-foreground">
            Record A{data.claim_a_document?.name ? " · " + data.claim_a_document.name : ""}
          </h2>
          <p className="mt-1 text-sm">{data.claim_a ?? "No text recorded."}</p>
        </div>
        <div className="rounded-xl border border-border p-4">
          <h2 className="text-sm font-medium text-muted-foreground">
            Record B{data.claim_b_document?.name ? " · " + data.claim_b_document.name : ""}
          </h2>
          <p className="mt-1 text-sm">{data.claim_b ?? "No text recorded."}</p>
        </div>
      </section>
    </main>
  );
}
