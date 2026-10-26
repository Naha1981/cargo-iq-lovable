import { Route as CaseRoute } from "./cases.$caseId";
import { createFileRoute } from "@tanstack/react-router";
import { CaseIntelligence } from "@/components/CaseIntelligence";

export const Route = createFileRoute("/cases/$caseId/intelligence")({
  head: () => ({ meta: [{ title: "Risk intelligence | CargoIQ" }] }),
  component: IntelligencePage,
});

function IntelligencePage() {
  const data = CaseRoute.useLoaderData();
  const { caseId } = Route.useParams();
  return <CaseIntelligence caseId={caseId} portCode={data.case?.port_code ?? null} />;
}
