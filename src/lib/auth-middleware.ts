import { createMiddleware } from "@tanstack/react-start";
import { getAuthed } from "@/lib/supabase/server";
import { pickMembership } from "@/lib/active-workspace";

export const tenantMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { supabase, user } = await getAuthed();
  if (!user) throw new Error("UNAUTHENTICATED");

  const { data: memberships } = await supabase
    .from("user_roles")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  let membership = pickMembership(memberships);

  if (!membership) {
    const { error } = await supabase.rpc("provision_organization", { org_name: user.user_metadata?.["organization_name"] ?? null });
    if (error) throw new Error("TENANT_PROVISION_FAILED: " + error.message);
    membership = pickMembership((await supabase.from("user_roles").select("tenant_id, role").eq("user_id", user.id).order("created_at", { ascending: true })).data);
  }
  if (!membership) throw new Error("TENANT_NOT_FOUND");

  return next({ context: { supabase: supabase as any, user, tenantId: membership.tenant_id as string, role: membership.role } });
});
