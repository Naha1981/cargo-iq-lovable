import { createServerFn } from "@tanstack/react-start";
import { getAuthed } from "@/lib/supabase/server";
import { resolveClaimAiProvider } from "@/lib/extraction.functions";

export const getCurrentUser = createServerFn({ method: "GET" }).handler(async () => {
  const { supabase, user } = await getAuthed();
  if (!user) return { user: null, tenantId: null, role: null };

  const { data: membership } = await supabase
    .from("user_roles")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return {
    user: { id: user.id, email: user.email ?? "", metadata: (user.user_metadata ?? {}) as Record<string, string> },
    tenantId: membership?.tenant_id ?? null,
    role: membership?.role ?? null,
  };
});

export const ensureOrganization = createServerFn({ method: "POST" }).inputValidator((d: { name?: string }) => d).handler(async ({ data }) => {
  const { supabase, user } = await getAuthed();
  if (!user) throw new Error("UNAUTHENTICATED");
  const { data: tenantId, error } = await supabase.rpc("provision_organization", {
    org_name: data?.name || user.user_metadata?.["organization_name"] || null,
  });
  if (error) throw new Error(error.message);
  return { tenantId };
});

export const runDiagnostics = createServerFn({ method: "GET" }).handler(async () => {
  const checks: { name: string; ok: boolean; detail: string; fix?: string }[] = [];
  const url = process.env["SUPABASE_URL"];
  checks.push({ name: "Backend connection settings", ok: Boolean(url && process.env["SUPABASE_PUBLISHABLE_KEY"]), detail: url ? "Connection details found." : "Connection details missing.", fix: "Reconnect Lovable Cloud for this project." });
  const ai = resolveClaimAiProvider();
  checks.push({ name: "AI document reading", ok: ai.kind !== "none", detail: ai.kind === "none" ? "AI key missing." : ai.label + ".", fix: "Add OPENAI_API_KEY or ANTHROPIC_API_KEY as a project secret, or ask the assistant to add the Lovable AI key." });
  const { supabase, user } = await getAuthed();
  const { error: dbErr } = await supabase.from("tenants").select("id", { head: true, count: "exact" });
  checks.push({ name: "Database ready", ok: !dbErr, detail: dbErr ? dbErr.message : "Tables reachable.", fix: "Ask the assistant to re-apply the database setup." });
  checks.push({ name: "Signed in", ok: Boolean(user), detail: user ? `Signed in as ${user.email}` : "Not signed in.", fix: "Sign in on the sign-in page." });
  if (user) {
    const { data: m } = await supabase.from("user_roles").select("tenant_id, role").eq("user_id", user.id).limit(1).maybeSingle();
    checks.push({ name: "Workspace access", ok: Boolean(m), detail: m ? `Role: ${m.role}` : "No workspace yet.", fix: "Sign out and sign in again — a workspace is created automatically." });
  }
  return checks;
});

export const deleteOwnAccount = createServerFn({ method: "POST" }).handler(async () => {
  const { supabase, user } = await getAuthed();
  if (!user) throw new Error("UNAUTHENTICATED");
  const { error } = await (supabase.rpc as any)("delete_own_account");
  if (error) throw new Error(error.message);
  return { deleted: true };
});
