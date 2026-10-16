import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { tenantMiddleware } from "@/lib/auth-middleware";
import { definitionInput } from "@/lib/operational-definitions";
export const listOperationalDefinitions=createServerFn({method:"GET"})
  .validator(z.object({caseId:z.string().uuid()})).middleware([tenantMiddleware])
  .handler(async({data,context})=>{
    const {data:rows,error}=await context.supabase.from("operational_definitions").select("*")
      .eq("case_id",data.caseId).eq("tenant_id",context.tenantId).order("created_at",{ascending:false});
    if(error) throw error;return rows??[];
  });
export const addOperationalDefinition=createServerFn({method:"POST"})
  .validator(definitionInput).middleware([tenantMiddleware])
  .handler(async({data,context})=>{
    if(!["admin","investigator"].includes(context.role)) throw new Error("Investigator access required");
    const {data:row,error}=await context.supabase.from("operational_definitions").insert({
      tenant_id:context.tenantId,case_id:data.caseId,party:data.party,metric:data.metric,
      unit:data.unit,rule:data.rule,original_source_text:data.originalSourceText,
      source_document_id:data.sourceDocumentId,source_reference:data.sourceReference,
      effective_from:data.effectiveFrom,effective_to:data.effectiveTo,
      acceptance:data.acceptance,acceptance_basis:data.acceptanceBasis,supersedes_id:data.supersedesId,
    }).select("*").single();
    if(error)throw error;return row;
  });
