import {createFileRoute,redirect} from "@tanstack/react-router";
import {getCurrentUser} from "@/lib/auth.functions";
import {AppHeader} from "@/components/ui-kit";
import {CufWorkspace} from "@/components/CufWorkspace";
export const Route=createFileRoute("/workspaces")({ssr:false,beforeLoad:async()=>{const s=await getCurrentUser();if(!s.user)throw redirect({to:"/auth"})},head:()=>({meta:[{title:"Member workspace | CargoIQ"},{name:"robots",content:"noindex,nofollow"}]}),component:()=> <><AppHeader/><CufWorkspace/></>});
