import {createServerFn} from "@tanstack/react-start";
import {z} from "zod";
import {tenantMiddleware} from "@/lib/auth-middleware";
export const sharedFields=["event_reference","event_type","timestamp","count","unit","source_excerpt","source_reference","limitations"] as const;
const ws=z.string().uuid();
const actionInput=z.discriminatedUnion("action",[
 z.object({action:z.literal("create"),name:z.string().trim().min(3).max(200),party:z.string().trim().min(2).max(200)}),
 z.object({action:z.literal("join"),workspaceId:ws,party:z.string().trim().min(2).max(200)}),
 z.object({action:z.literal("member"),workspaceId:ws,userId:ws,status:z.enum(["ACTIVE","REVOKED"])}),
 z.object({action:z.literal("contribute"),workspaceId:ws,payload:z.record(z.enum(sharedFields),z.string().max(4000))}),
 z.object({action:z.literal("grant"),contributionId:ws,userId:ws,fields:z.array(z.enum(sharedFields)).min(1).max(8)}),
 z.object({action:z.literal("revoke"),contributionId:ws,userId:ws}),
]);
export const cufWorkspaceAction=createServerFn({method:"POST"}).validator(actionInput).middleware([tenantMiddleware]).handler(async({data,context})=>{
 let result:any;
 if(data.action==="create")result=await context.supabase.rpc("cuf_create",{n:data.name,p:data.party});
 else if(data.action==="join")result=await context.supabase.rpc("cuf_request_join",{w:data.workspaceId,p:data.party});
 else if(data.action==="member")result=await context.supabase.rpc("cuf_set_member",{w:data.workspaceId,u:data.userId,s:data.status});
 else if(data.action==="contribute")result=await context.supabase.rpc("cuf_add_contribution",{w:data.workspaceId,p:data.payload});
 else if(data.action==="grant")result=await context.supabase.rpc("cuf_grant",{c:data.contributionId,u:data.userId,f:data.fields});
 else result=await context.supabase.rpc("cuf_revoke",{c:data.contributionId,u:data.userId});
 if(result.error)throw result.error;return result.data;
});
export const listCufWorkspaces=createServerFn({method:"GET"}).middleware([tenantMiddleware]).handler(async({context})=>{
 const {data,error}=await context.supabase.from("cuf_workspaces").select("*").order("created_at",{ascending:false});if(error)throw error;return {userId:context.user.id,workspaces:data??[]};
});
export const readCufWorkspace=createServerFn({method:"GET"}).validator(z.object({workspaceId:ws})).middleware([tenantMiddleware]).handler(async({data,context})=>{
 const db=context.supabase;const [members,own,shared,workspace]=await Promise.all([
  db.from("cuf_members").select("*").eq("workspace_id",data.workspaceId),
  db.from("cuf_contributions").select("*").eq("workspace_id",data.workspaceId).eq("author_id",context.user.id),
  db.rpc("cuf_read_shared",{w:data.workspaceId}),
  db.from("cuf_workspaces").select("*").eq("id",data.workspaceId).single(),
 ]);for(const x of [members,own,shared,workspace])if(x.error)throw x.error;
 const ids=(own.data??[]).map((x:any)=>x.id);const grants=ids.length?await db.from("cuf_field_grants").select("*").in("contribution_id",ids):{data:[],error:null};if(grants.error)throw grants.error;
 return {userId:context.user.id,workspace:workspace.data,members:members.data??[],own:own.data??[],shared:shared.data??[],grants:grants.data??[]};
});
