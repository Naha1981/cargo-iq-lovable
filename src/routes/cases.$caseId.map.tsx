import { createFileRoute } from "@tanstack/react-router";
import { Route as CaseRoute } from "./cases.$caseId";
import { HarbourEvidenceMap } from "@/components/HarbourEvidenceMap";
export const Route = createFileRoute("/cases/$caseId/map")({
  head: () => ({ meta: [{ title: "Harbour Evidence Map | CargoIQ" }] }),
  component: MapPage,
});
export function MapPage() {
  const data = CaseRoute.useLoaderData();
  return <HarbourEvidenceMap data={{ ...data, case: data.case! }} />;
}
