import {createFileRoute} from "@tanstack/react-router";
import {Route as CaseRoute} from "./cases.$caseId";
import {CountingLedger} from "@/components/CountingLedger";
export const Route=createFileRoute("/cases/$caseId/counts")({component:()=>{const {caseId}=Route.useParams();return <CountingLedger key={caseId} caseId={caseId} documents={CaseRoute.useLoaderData().documents}/>;}});
