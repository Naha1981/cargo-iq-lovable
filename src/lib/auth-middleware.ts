import { createMiddleware } from "@tanstack/react-start";
import { createClient } from "@/lib/supabase/server";

export const tenantMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const supabase = createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("UNAUTHENTICATED");

  const { data: membership, error: membershipError } = await supabase
    .from("user_roles")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership) throw new Error("TENANT_NOT_FOUND");

  return next({ context: { supabase, user, tenantId: membership.tenant_id as string, role: membership.role } });
});
