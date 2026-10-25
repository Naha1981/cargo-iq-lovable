import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { tenantMiddleware } from "@/lib/auth-middleware";
import { getAuthed } from "@/lib/supabase/server";
import { asInvitationError, rpcClient } from "@/lib/rpc-client";

// The generated Supabase types don't know these functions yet; call rpc through a
// narrow typed signature instead of `as any` so new code keeps the lint gate clean.
export { INVITES_NOT_INSTALLED } from "@/lib/rpc-client";

// Team invitations (request 25 Oct: team onboarding without the unsafe pasted design).
// All authorization lives in the database functions (migration
// 20261025120000_tenant_invitations): only tenant admins can create/list/revoke, the
// invited email is binding at accept time, tokens are single-use and expire.
// The app never sends email itself: the admin copies the invite link and shares it
// through their own reviewed channel, so no outbound message ever goes out unreviewed.

export type Invitation = {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
  expired: boolean;
};

export const createInvitation = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      email: z.string().trim().email().max(320),
      role: z.enum(["admin", "investigator", "viewer"]),
    }),
  )
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    const client = rpcClient(context.supabase);
    const { data: result, error } = await client.rpc("create_tenant_invitation", {
      p_tenant_id: context.tenantId,
      p_email: data.email,
      p_role: data.role,
    });
    if (error) throw asInvitationError(error);
    const created = result as { id?: string; token?: string; expires_at?: string } | null;
    if (!created?.token || !created.id || !created.expires_at)
      throw new Error("Invitation was not created.");
    return { id: created.id, token: created.token, expiresAt: created.expires_at };
  });

export const listInvitations = createServerFn({ method: "GET" })
  .middleware([tenantMiddleware])
  .handler(async ({ context }) => {
    const client = rpcClient(context.supabase);
    const { data, error } = await client.rpc("list_tenant_invitations", {
      p_tenant_id: context.tenantId,
    });
    if (error) throw asInvitationError(error);
    return (data ?? []) as Invitation[];
  });

export const revokeInvitation = createServerFn({ method: "POST" })
  .inputValidator(z.object({ invitationId: z.string().uuid() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    const client = rpcClient(context.supabase);
    const { data: result, error } = await client.rpc("revoke_tenant_invitation", {
      p_invitation_id: data.invitationId,
    });
    if (error) throw asInvitationError(error);
    return { status: result as string };
  });

// Accept is deliberately NOT tenant-scoped: the accepting user usually has no
// membership in the inviting tenant yet, and tenantMiddleware would auto-provision
// them their own organization instead. The invitation token carries the tenant.
export const acceptInvitation = createServerFn({ method: "POST" })
  .inputValidator(z.object({ token: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { supabase, user } = await getAuthed();
    if (!user) throw new Error("UNAUTHENTICATED");
    const client = rpcClient(supabase);
    const { data: status, error } = await client.rpc("accept_tenant_invitation", {
      p_token: data.token,
    });
    if (error) throw asInvitationError(error);
    return { status: status as string };
  });
