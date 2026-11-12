import { GaussianSplatPanel } from "@/components/GaussianSplatPanel";
import { IntegratedFeatureGate } from "@/components/IntegratedFeatureGate";
import { Route as CaseRoute } from "./cases.$caseId";
import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const SceneView = lazy(() =>
  import("@/components/SceneView").then((m) => ({ default: m.SceneView })),
);

export const Route = createFileRoute("/cases/$caseId/scene")({
  head: () => ({ meta: [{ title: "3D Scene | CargoIQ" }] }),
  component: ScenePageGate,
});

function ScenePage() {
  const { caseId } = Route.useParams();
  const data = CaseRoute.useLoaderData();
  return (
    <Suspense
      fallback={
        <div role="status" className="p-10 text-sm text-muted-foreground">
          Loading 3D scene tools...
        </div>
      }
    >
      <SceneView caseId={caseId} caseEvents={data.timeline} documents={data.documents} />
    </Suspense>
  );
}

function ScenePageGate() {
  const data = CaseRoute.useLoaderData();
  const { caseId } = Route.useParams();
  return (
    <div className="space-y-6">
      <GaussianSplatPanel caseId={caseId} tenantId={data.tenantId} />
      <IntegratedFeatureGate title="3D Scene">
        <ScenePage />
      </IntegratedFeatureGate>
    </div>
  );
}
