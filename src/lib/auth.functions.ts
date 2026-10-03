import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@/lib/supabase/server";

export const getCurrentUser = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, tenantId: null, role: null };

  const { data: membership } = await supabase
    .from("user_roles")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return {
    user: { id: user.id, email: user.email ?? "", metadata: user.user_metadata ?? {} },
    tenantId: membership?.tenant_id ?? null,
    role: membership?.role ?? null,
  };
});

export const ensureOrganization = createServerFn({ method: "POST" }).handler(async ({ data }: { data: { name?: string } }) => {
  const supabase = createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("UNAUTHENTICATED");
  const { data: tenantId, error: rpcError } = await supabase.rpc("provision_organization", {
    org_name: data?.name ?? user.user_metadata?.organization_name ?? null,
  });
  if (rpcError) throw rpcError;
  return { tenantId };
});
