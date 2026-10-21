import {recordFromDb, ruleFromDb} from "./count-ledger";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { tenantMiddleware } from "./auth-middleware";
import { countRecordInput, countRuleInput, type CountRecord, type CountRule } from "./count-ledger";
export const listCountLedger=createServerFn({method:"GET"}).validator(z.object({caseId:z.string().uuid()})).middleware([tenantMiddleware]).handler(async({data,context})=>{
 const db=context.supabase;const [sources,rules]=await Promise.all([db.from("count_source_records").select("*").eq("case_id",data.caseId).order("created_at",{ascending:true}),db.from("count_rule_versions").select("*").eq("case_id",data.caseId).order("created_at",{ascending:true})]);
 if(sources.error||rules.error)throw new Error("Count ledger is unavailable. The reviewed count-ledger migration must be applied before use. "+(sources.error?.message||rules.error?.message));
 return {records:(sources.data??[]).map(recordFromDb),rules:(rules.data??[]).map(ruleFromDb)};
});
export const appendCountRecord=createServerFn({method:"POST"}).validator(countRecordInput).middleware([tenantMiddleware]).handler(async({data:d,context:c})=>{
 if(!["admin","investigator"].includes(c.role))throw new Error("Investigator access required");
 const {data,error}=await c.supabase.from("count_source_records").insert({tenant_id:c.tenantId,case_id:d.caseId,physical_reference:d.physicalReference,party:d.party.trim(),metric:d.metric,basis:d.basis,quantity:d.quantity,occurred_at:d.occurredAt,containers20:d.containers20,containers40:d.containers40,gate_kind:d.gateKind,source_document_id:d.sourceDocumentId,source_reference:d.sourceReference,limitations:d.limitations,supersedes_id:d.supersedesId}).select("*").single();if(error)throw error;return recordFromDb(data);
});
export const appendCountRule=createServerFn({method:"POST"}).validator(countRuleInput).middleware([tenantMiddleware]).handler(async({data:d,context:c})=>{
 if(!["admin","investigator"].includes(c.role))throw new Error("Investigator access required");
 const {data,error}=await c.supabase.from("count_rule_versions").insert({tenant_id:c.tenantId,case_id:d.caseId,name:d.name,metric:d.metric,input_basis:d.inputBasis,output_unit:d.outputUnit,calculation:d.calculation,numerator:d.numerator,denominator:d.denominator,gate_kinds:d.gateKinds,acceptance:d.acceptance,effective_from:d.effectiveFrom,effective_to:d.effectiveTo,source_document_id:d.sourceDocumentId,source_reference:d.sourceReference,rationale:d.rationale,supersedes_id:d.supersedesId}).select("*").single();if(error)throw error;return ruleFromDb(data);
});
