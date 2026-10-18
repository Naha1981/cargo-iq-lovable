import { createClient } from "@/lib/supabase/client";

const COOKIE = "nl_workspace";

export type Workspace = { tenant_id: string; name: string; role: "admin" | "investigator" | "viewer" };
export type Member = { user_id: string; email: string; role: Workspace["role"]; joined_at: string };

export function activeWorkspaceId(): string | null {
  const m = document.cookie.split(/;\s*/).find((p) => p.startsWith(COOKIE + "="));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
}
export function setActiveWorkspace(id: string) {
  document.cookie = `${COOKIE}=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
}

// The helper RPCs are newer than the generated types, so call through an untyped handle.
const rpc = async <T,>(fn: string, args?: Record<string, unknown>): Promise<T> => {
  const { data, error } = await (createClient() as any).rpc(fn, args ?? {});
  if (error) throw new Error(friendly(error.message));
  return data as T;
};

export function friendly(msg: string): string {
  if (msg.includes("ADMIN_REQUIRED")) return "Only a workspace admin can do that.";
  if (msg.includes("LAST_ADMIN")) return "A workspace must keep at least one admin.";
  if (msg.includes("INVITE_INVALID")) return "This invite link is no longer valid. Ask the admin for a new one.";
  if (msg.includes("WORKSPACE_LIMIT")) return "You have reached the workspace limit.";
  if (msg.includes("UNAUTHENTICATED")) return "Please sign in first.";
  return msg;
}

export const listWorkspaces = () => rpc<Workspace[]>("my_workspaces");
export const createWorkspace = (name: string) => rpc<string>("create_workspace", { org_name: name });
export const listMembers = (tenant: string) => rpc<Member[]>("list_members", { _tenant: tenant });
export const setMemberRole = (tenant: string, user: string, role: string) => rpc<void>("set_member_role", { _tenant: tenant, _user: user, _role: role });
export const removeMember = (tenant: string, user: string) => rpc<void>("remove_member", { _tenant: tenant, _user: user });
export const createInvite = (tenant: string, role: string) => rpc<string>("create_invite", { _tenant: tenant, _role: role });
export const revokeInvite = (tenant: string) => rpc<void>("revoke_invite", { _tenant: tenant });
export const currentInvite = async (tenant: string) => (await rpc<{ token: string; role: string; expires_at: string }[]>("current_invite", { _tenant: tenant }))[0] ?? null;
export const inviteInfo = async (token: string) => (await rpc<{ org_name: string; role: string }[]>("invite_info", { _token: token }))[0] ?? null;
export const acceptInvite = (token: string) => rpc<string>("accept_invite", { _token: token });
export const inviteUrl = (token: string) => `${location.origin}/join/${token}`;
