import {z} from "zod";
export const matchInput=z.object({caseId:z.string().uuid(),claimAId:z.string().uuid(),claimBId:z.string().uuid(),eventReference:z.string().trim().min(3).max(200),rationale:z.string().trim().min(10).max(4000)}).refine(x=>x.claimAId!==x.claimBId,{message:"Select two distinct source claims"});
export function classifyMatchedClaims(a:any,b:any){
 if(!a.claim_type||a.claim_type!==b.claim_type||a.claim_type==="TEXT_RECORD")return {kind:"HUMAN_REVIEW",description:"Different counting bases or fact types require review; no timestamp contradiction inferred."};
 if(!a.timestamp_claimed||!b.timestamp_claimed)return {kind:"MISSING_TIME",description:"A matched source lacks timestamp evidence; no time conflict inferred."};
 const delta=Math.abs(Date.parse(a.timestamp_claimed)-Date.parse(b.timestamp_claimed));
 if(!Number.isFinite(delta))return {kind:"MISSING_TIME",description:"Timestamp cannot be verified."};
 if(delta>=3600000)return {kind:"TIMESTAMP_CONFLICT",description:`Human-confirmed same physical event; source timestamps differ by ${delta/3600000} hour(s).`};
 return {kind:"NO_THRESHOLD_CONFLICT",description:"Source timestamps differ by less than the current one-hour detector threshold. This is not automatic verification or proof of exact agreement."};
}
