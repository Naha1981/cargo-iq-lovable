import { Route as CaseRoute } from "./cases.$caseId";
import { createFileRoute } from "@tanstack/react-router";
import { OperationalDefinitionRegister } from "@/components/OperationalDefinitionRegister";
export const Route=createFileRoute("/cases/$caseId/definitions")({head:()=>({meta:[{title:"Counting definitions | CargoIQ"}]}),component:()=>{const data=CaseRoute.useLoaderData();const {caseId}=Route.useParams();return <OperationalDefinitionRegister caseId={caseId} documents={data.documents}/>;}});
