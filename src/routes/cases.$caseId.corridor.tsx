import { Route as CaseRoute } from "./cases.$caseId";
import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const CorridorView = lazy(() =>
  import("@/components/CorridorView").then((m) => ({ default: m.CorridorView })),
);

export const Route = createFileRoute("/cases/$caseId/corridor")({
  head: () => ({ meta: [{ title: "Logistics Corridor | CargoIQ" }] }),
  component: CorridorPage,
});

function CorridorPage() {
  const data = CaseRoute.useLoaderData();
  const { caseId } = Route.useParams();
  return (
    <Suspense
      fallback={
        <div role="status" className="p-10 text-sm text-muted-foreground">
          Loading corridor map...
        </div>
      }
    >
      <CorridorView
        caseId={caseId}
        portCode={data.case?.port_code ?? null}
        timeline={data.timeline}
        observations={data.observations}
        vesselName={data.case.vessel_name}
      />
    </Suspense>
  );
}
