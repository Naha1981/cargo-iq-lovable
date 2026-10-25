import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getAuthed } from "@/lib/supabase/server";
import { freeWorkspaceDailyAttemptCap } from "@/lib/extraction.functions";

// Deliberately NOT tenantMiddleware: the owner panel is cross-tenant and must never
// auto-provision an organization for a caller.
const authedOnly = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { supabase, user } = await getAuthed();
  if (!user) throw new Error("Not found.");
  return next({ context: { supabase: supabase as any, user } });
});

// Owner-only platform administration (request 25 Oct: "super admin panel for me alone").
// Authorization is decided INSIDE the database functions (migration 20261024219000):
// the caller's own auth-JWT email must be in the platform_admins allowlist - no client
// flags, no workspace role, no email hardcoded in code. Every failure mode returns the
// same opaque "Not found." so the panel's existence is not disclosed to non-owners.

export type AdminTenant = { id: string; name: string; created_at: string; users: number; cases: number };
export type AdminUser = { tenant_id: string; user_id: string; role: string; display: string; email: string | null };
export type AdminCase = { id: string; tenant_id: string; title: string; created_at: string; open_disputes: number };
export type AdminDispute = { id: string; case_id: string; case_title: string | null; summary: string | null; source_documents: string[]; status: string; created_at: string };
export type AdminDisputeDetail = { id: string; status: string; created_at: string; case_id: string; case_title: string | null; tenant_id: string; claim_a: string | null; claim_b: string | null; claim_a_document: { id: string | null; name: string | null }; claim_b_document: { id: string | null; name: string | null } };
export type AdminPage<T> = { rows: T[]; total: number; next_cursor: string | null };
export type AdminOverview = { tenants: AdminPage<AdminTenant>; users: AdminPage<AdminUser>; cases: AdminPage<AdminCase>; disputes: AdminPage<AdminDispute> };

const opaque = () => new Error("Not found.");
const PAGE = 100;

export const getPlatformAdminOverview = createServerFn({ method: "GET" })
  .validator(z.object({}).strict())
  .middleware([authedOnly])
  .handler(async ({ context }: any) => {
    const supabase = context?.supabase;
    if (!supabase) throw opaque();
    const call = async (fn: string) => {
      const { data, error } = await supabase.rpc(fn, { p_limit: PAGE });
      if (error) throw opaque();
      return data;
    };
    try {
      const [tenants, users, cases, disputes] = await Promise.all([
        call("admin_list_tenants"), call("admin_list_users"), call("admin_list_cases"), call("admin_list_disputes"),
      ]);
      return { tenants, users, cases, disputes } as AdminOverview;
    } catch {
      throw opaque();
    }
  });

// Follow a section's next_cursor. Following cursors reaches every row; the UI always
// shows "loaded of total" so a bounded page is never mistaken for the whole list.
export const getPlatformAdminMore = createServerFn({ method: "GET" })
  .validator(z.object({ section: z.enum(["tenants", "users", "cases", "disputes"]), cursor: z.string() }).strict())
  .middleware([authedOnly])
  .handler(async ({ context, data }: any) => {
    const supabase = context?.supabase;
    if (!supabase) throw opaque();
    const { data: page, error } = await supabase.rpc("admin_list_" + data.section, { p_limit: PAGE, p_cursor: data.cursor });
    if (error || !page) throw opaque();
    return page;
  });

export const getPlatformAdminDispute = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }).strict())
  .middleware([authedOnly])
  .handler(async ({ context, data }: any) => {
    const supabase = context?.supabase;
    if (!supabase) throw opaque();
    const { data: row, error } = await supabase.rpc("admin_get_dispute", { p_id: data.id });
    if (error || !row) throw opaque();
    return row as AdminDisputeDetail;
  });

// Owner-settable per-workspace free-extraction daily caps (migration 20261025200000).
// The setting lives in the database so the owner changes it from this panel, without a
// developer or a deploy: NULL = inherit the global default, 0 = this workspace off,
// 1..10000 = its daily limit. The global env control (CLAIM_FREE_WORKSPACE_DAILY_ATTEMPTS)
// stays the platform-wide default AND emergency off: 0/invalid there turns free extraction
// off everywhere, over every workspace row - enforcement lives in the reserve RPC.
export type AdminTenantCap = { tenant_id: string; name: string; override: number | null; attempts_today: number };
export type AdminTenantCaps = { rows: AdminTenantCap[]; total: number; default_cap: number };

export const getPlatformAdminTenantCaps = createServerFn({ method: "GET" })
  .validator(z.object({}).strict())
  .middleware([authedOnly])
  .handler(async ({ context }: any) => {
    const supabase = context?.supabase;
    if (!supabase) throw opaque();
    const { data, error } = await supabase.rpc("admin_list_tenant_free_caps");
    if (error || !data) throw opaque();
    return { ...(data as { rows: AdminTenantCap[]; total: number }), default_cap: freeWorkspaceDailyAttemptCap() } as AdminTenantCaps;
  });

export const setPlatformAdminTenantCap = createServerFn({ method: "POST" })
  .validator(z.object({ tenantId: z.string().uuid(), dailyAttempts: z.number().int().min(0).max(10000).nullable() }).strict())
  .middleware([authedOnly])
  .handler(async ({ context, data }: any) => {
    const supabase = context?.supabase;
    if (!supabase) throw opaque();
    const { error } = await supabase.rpc("admin_set_tenant_free_cap", { p_tenant_id: data.tenantId, p_daily_attempts: data.dailyAttempts });
    if (error) throw opaque();
    return { tenant_id: data.tenantId, daily_attempts: data.dailyAttempts };
  });
