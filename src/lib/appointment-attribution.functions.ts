import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { tenantMiddleware } from "@/lib/auth-middleware";
export const attributionInput=z.object({caseId:z.string().uuid(),appointmentClockId:z.string().uuid(),claimant:z.string().trim().min(2).max(200),claimTarget:z.string().trim().min(2).max(200),assertion:z.string().trim().min(10).max(4000),sourceDocumentId:z.string().uuid(),sourceReference:z.string().trim().min(3).max(1000),termsReference:z.string().trim().min(3).max(2000)});
export const listAppointmentAttributions=createServerFn({method:"GET"}).validator(z.object({caseId:z.string().uuid()})).middleware([tenantMiddleware]).handler(async({data,context})=>{
 const {data:rows,error}=await context.supabase.from("appointment_attributions").select("*").eq("case_id",data.caseId).eq("tenant_id",context.tenantId).order("created_at",{ascending:false});if(error)throw error;return rows??[];
});
export const addAppointmentAttribution=createServerFn({method:"POST"}).validator(attributionInput).middleware([tenantMiddleware]).handler(async({data,context})=>{
 if(!["admin","investigator"].includes(context.role))throw new Error("Investigator access required");
 const {data:row,error}=await context.supabase.from("appointment_attributions").insert({tenant_id:context.tenantId,case_id:data.caseId,appointment_clock_id:data.appointmentClockId,claimant:data.claimant,claim_target:data.claimTarget,assertion:data.assertion,source_document_id:data.sourceDocumentId,source_reference:data.sourceReference,terms_reference:data.termsReference}).select("*").single();if(error)throw error;return row;
});
