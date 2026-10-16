import { Route as CaseRoute } from "./cases.$caseId";
import { createFileRoute } from "@tanstack/react-router";
import { AppointmentAttribution } from "@/components/AppointmentAttribution";

export const Route = createFileRoute("/cases/$caseId/appointments")({
  head: () => ({ meta: [{ title: "Appointment attribution | CargoIQ" }] }),
  component: AppointmentsPage,
});

function AppointmentsPage() {
  const data = CaseRoute.useLoaderData();
  const { caseId } = Route.useParams();
  return <AppointmentAttribution caseId={caseId} documents={data.documents} />;
}
