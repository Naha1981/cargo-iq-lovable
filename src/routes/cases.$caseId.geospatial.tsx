import { IntegratedFeatureGate } from "@/components/IntegratedFeatureGate";
import { Route as CaseRoute } from "./cases.$caseId";
import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const GehiWorkspace = lazy(() =>
  import("@/components/GehiWorkspace").then((m) => ({ default: m.GehiWorkspace })),
);

export const Route = createFileRoute("/cases/$caseId/geospatial")({
  head: () => ({ meta: [{ title: "Geospatial Evidence | CargoIQ" }] }),
  component: GehiPageGate,
});

function GehiPage() {
  const data = CaseRoute.useLoaderData();
  const { caseId } = Route.useParams();
  return (
    <Suspense
      fallback={
        <div role="status" className="p-10 text-sm text-muted-foreground">
          Loading geospatial workspace...
        </div>
      }
    >
      <GehiWorkspace
        caseId={caseId}
        caseLabel={data.case?.reference_no}
        portCode={data.case?.port_code ?? null}
        observations={data.observations}
      />
    </Suspense>
  );
}

function GehiPageGate() {
  return (
    <IntegratedFeatureGate title="Geospatial Evidence">
      <GehiPage />
    </IntegratedFeatureGate>
  );
}
