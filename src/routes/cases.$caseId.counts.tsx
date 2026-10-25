import { createFileRoute } from "@tanstack/react-router";
import { Route as CaseRoute } from "./cases.$caseId";
import { CountingLedger } from "@/components/CountingLedger";

function CountsPage() {
  const { caseId } = Route.useParams();
  const data = CaseRoute.useLoaderData();
  return <CountingLedger key={caseId} caseId={caseId} documents={data.documents} />;
}

export const Route = createFileRoute("/cases/$caseId/counts")({
  component: CountsPage,
});
