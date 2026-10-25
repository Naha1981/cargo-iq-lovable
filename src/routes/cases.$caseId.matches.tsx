import { Route as CaseRoute } from "./cases.$caseId";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { CrossPartyEventMatches } from "@/components/CrossPartyEventMatches";

export const Route = createFileRoute("/cases/$caseId/matches")({
  head: () => ({ meta: [{ title: "Cross-party matches | CargoIQ" }] }),
  component: MatchesPage,
});

function MatchesPage() {
  const data = CaseRoute.useLoaderData();
  const { caseId } = Route.useParams();
  const router = useRouter();
  return (
    <CrossPartyEventMatches
      caseId={caseId}
      documents={data.documents}
      claims={data.claims}
      onChanged={() => router.invalidate()}
    />
  );
}
