import { Route as CaseRoute } from "./cases.$caseId";
import { createFileRoute } from "@tanstack/react-router";
import { OperationalClockRegister } from "@/components/OperationalClockRegister";
export const Route=createFileRoute("/cases/$caseId/clocks")({head:()=>({meta:[{title:"Source clocks | CargoIQ"}]}),component:()=>{const data=CaseRoute.useLoaderData();const {caseId}=Route.useParams();return <OperationalClockRegister caseId={caseId} documents={data.documents}/>;}});
