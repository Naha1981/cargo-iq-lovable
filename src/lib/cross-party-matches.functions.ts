import {createServerFn} from "@tanstack/react-start";
import {z} from "zod";
import {tenantMiddleware} from "@/lib/auth-middleware";
import {matchInput} from "@/lib/cross-party-matches";
export const listCrossPartyMatches=createServerFn({method:"GET"}).validator(z.object({caseId:z.string().uuid()})).middleware([tenantMiddleware]).handler(async({data,context})=>{const {data:rows,error}=await context.supabase.from("cross_party_matches").select("*").eq("case_id",data.caseId).eq("tenant_id",context.tenantId).order("created_at",{ascending:false});if(error)throw error;return rows??[]});
export const confirmCrossPartyMatch=createServerFn({method:"POST"}).validator(matchInput).middleware([tenantMiddleware]).handler(async({data,context})=>{if(!["admin","investigator"].includes(context.role))throw new Error("Investigator access required");const ids=[data.claimAId,data.claimBId].sort();const {data:row,error}=await context.supabase.from("cross_party_matches").insert({tenant_id:context.tenantId,case_id:data.caseId,claim_a_id:ids[0],claim_b_id:ids[1],event_reference:data.eventReference,rationale:data.rationale}).select("*").single();if(error)throw error;return row});
