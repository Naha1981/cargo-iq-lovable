import { IntegratedFeatureGate } from "@/components/IntegratedFeatureGate";
import { Route as CaseRoute } from "./cases.$caseId";
import { createFileRoute } from "@tanstack/react-router";
import { SimulationLab } from "@/components/SimulationLab";

export const Route = createFileRoute("/cases/$caseId/simulation")({
  head: () => ({ meta: [{ title: "Simulation Lab | CargoIQ" }] }),
  component: SimulationPageGate,
});

function SimulationPage() {
  const data = CaseRoute.useLoaderData();
  const { caseId } = Route.useParams();
  return <SimulationLab caseId={caseId} portCode={data.case?.port_code ?? null} />;
}

function SimulationPageGate() {
  return (
    <IntegratedFeatureGate title="Simulation Lab">
      <SimulationPage />
    </IntegratedFeatureGate>
  );
}
