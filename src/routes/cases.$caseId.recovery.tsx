import { IntegratedFeatureGate } from "@/components/IntegratedFeatureGate";
import { Route as CaseRoute } from "./cases.$caseId";
import { Link, createFileRoute } from "@tanstack/react-router";
import { RevenueRecovery } from "@/components/RevenueRecovery";

export const Route = createFileRoute("/cases/$caseId/recovery")({
  head: () => ({ meta: [{ title: "Revenue Recovery | CargoIQ" }] }),
  component: RecoveryPageGate,
});

function RecoveryPage() {
  const { caseId } = Route.useParams();
  const data = CaseRoute.useLoaderData();
  const unresolved = data.contradictions.filter((c) => c.status === "FLAGGED").length;
  return (
    <div className="space-y-4">
      {unresolved > 0 && (
        <div role="alert" className="rounded border border-disputed/50 bg-disputed/10 p-4 text-sm">
          <p className="font-semibold">
            Review {unresolved} unresolved contradictions before relying on recovery figures.
          </p>
          <Link
            to="/cases/$caseId/documents"
            params={{ caseId }}
            className="mt-3 inline-flex min-h-11 items-center rounded border px-3 font-semibold"
          >
            Review unresolved contradictions
          </Link>
        </div>
      )}
      <RevenueRecovery caseId={caseId} documents={data.documents} />
    </div>
  );
}

function RecoveryPageGate() {
  return (
    <IntegratedFeatureGate title="Revenue Recovery">
      <RecoveryPage />
    </IntegratedFeatureGate>
  );
}
