import { IntegratedFeatureGate } from "@/components/IntegratedFeatureGate";
import { Route as CaseRoute } from "./cases.$caseId";
import { createFileRoute } from "@tanstack/react-router";
import { RevenueRecovery } from "@/components/RevenueRecovery";

export const Route = createFileRoute("/cases/$caseId/recovery")({
  head: () => ({ meta: [{ title: "Revenue Recovery | CargoIQ" }] }),
  component: RecoveryPageGate,
});

function RecoveryPage() {
  const { caseId } = Route.useParams();
  const data = CaseRoute.useLoaderData();
  return <RevenueRecovery caseId={caseId} documents={data.documents} />;
}

function RecoveryPageGate() {
  return (
    <IntegratedFeatureGate title="Revenue Recovery">
      <RecoveryPage />
    </IntegratedFeatureGate>
  );
}
