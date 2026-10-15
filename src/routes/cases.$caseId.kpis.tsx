import { Route as CaseRoute } from "./cases.$caseId";
import { createFileRoute } from "@tanstack/react-router";
import { KpiDefinitionRegister } from "@/components/KpiDefinitionRegister";

export const Route = createFileRoute("/cases/$caseId/kpis")({
  head: () => ({ meta: [{ title: "KPI definitions | CargoIQ" }] }),
  component: KpisPage,
});

function KpisPage() {
  const data = CaseRoute.useLoaderData();
  const { caseId } = Route.useParams();
  return <KpiDefinitionRegister caseId={caseId} documents={data.documents} />;
}
