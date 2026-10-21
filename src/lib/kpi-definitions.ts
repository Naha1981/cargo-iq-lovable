import {z} from "zod";
import {reconciledClockGroup} from "./operational-clocks";
export const kpiInput=z.object({caseId:z.string().uuid(),party:z.string().trim().min(2).max(200),name:z.string().trim().min(3).max(200),physicalReference:z.string().trim().min(3).max(200),startKind:z.string().min(3).max(100),endKind:z.string().min(3).max(100),definition:z.string().trim().min(10).max(4000),sourceDocumentId:z.string().uuid(),sourceReference:z.string().trim().min(3).max(1000),acceptance:z.enum(["CONTRACTUALLY_SPECIFIED","AGREED","PARTY_REPORTED","UNRESOLVED"]),benchmarkHours:z.number().nonnegative().max(100000).nullable(),benchmarkBasis:z.string().trim().min(10).max(4000),supersedesId:z.string().uuid().nullable()}).refine(x=>x.startKind!==x.endKind,{message:"Start and end must identify different event types",path:["endKind"]});
export function evaluateKpi(definition:any,clocks:any[],decisions:any[]=[]){
 const times=(kind:string)=>reconciledClockGroup(clocks.filter(c=>c.physical_reference===definition.physical_reference&&c.kind===kind),decisions).times;
 const a=times(definition.start_kind),b=times(definition.end_kind);
 const status=!a.length||!b.length?"MISSING":a.length!==1||b.length!==1?"CONFLICTING":b[0]<a[0]?"INVALID_ORDER":"DERIVED";
 const hours=status==="DERIVED"?(b[0]-a[0])/3600000:null;
 const agreed=["AGREED","CONTRACTUALLY_SPECIFIED"].includes(definition.acceptance);
 return {status,hours,referenceHours:agreed&&definition.benchmark_hours!==null?Number(definition.benchmark_hours):null,sourceIds:clocks.filter(c=>c.physical_reference===definition.physical_reference&&[definition.start_kind,definition.end_kind].includes(c.kind)).map(c=>c.id)};
}
