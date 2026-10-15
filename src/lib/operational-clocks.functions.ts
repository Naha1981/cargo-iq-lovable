import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { tenantMiddleware } from "@/lib/auth-middleware";
import { clockInput } from "@/lib/operational-clocks";
export const listOperationalClocks=createServerFn({method:"GET"}).validator(z.object({caseId:z.string().uuid()})).middleware([tenantMiddleware]).handler(async({data,context})=>{
 const {data:rows,error}=await context.supabase.from("operational_clocks").select("*").eq("case_id",data.caseId).eq("tenant_id",context.tenantId).order("occurred_at",{ascending:true});if(error)throw error;return rows??[];
});
export const addOperationalClock=createServerFn({method:"POST"}).validator(clockInput).middleware([tenantMiddleware]).handler(async({data,context})=>{
 if(!["admin","investigator"].includes(context.role))throw new Error("Investigator access required");
 const {data:row,error}=await context.supabase.from("operational_clocks").insert({tenant_id:context.tenantId,case_id:data.caseId,physical_reference:data.physicalReference,kind:data.kind,timestamp_original:data.timestamp,occurred_at:data.timestamp,time_zone:data.timeZone,source_party:data.sourceParty,source_document_id:data.sourceDocumentId,source_reference:data.sourceReference,location_basis:data.locationBasis,appointment_issuer:data.appointmentIssuer||null,appointment_reference:data.appointmentReference||null,appointment_parties:data.appointmentParties||null,appointment_terms:data.appointmentTerms||null}).select("*").single();if(error)throw error;return row;
});
