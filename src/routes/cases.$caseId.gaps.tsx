import { Route as CaseRoute } from "./cases.$caseId";
import { createFileRoute } from "@tanstack/react-router";
import { EvidenceGapRegister } from "@/components/EvidenceGapRegister";

export const Route = createFileRoute("/cases/$caseId/gaps")({
  head: () => ({ meta: [{ title: "Evidence gaps | CargoIQ" }] }),
  component: GapsPage,
});

function GapsPage() {
  const data = CaseRoute.useLoaderData();
  const { caseId } = Route.useParams();
  return <EvidenceGapRegister caseId={caseId} documents={data.documents} />;
}
