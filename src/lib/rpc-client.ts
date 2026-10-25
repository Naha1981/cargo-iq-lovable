// Narrow typed rpc access that PRESERVES the method binding: supabase-js implements
// rpc as `this.rest.rpc(...)`, so extracting `client.rpc` into a bare variable (or
// destructuring it) throws "Cannot read properties of undefined (reading 'rest')"
// before any request is made. Always call through the object: rpcClient(sb).rpc(...).
export type RpcResult = { data: unknown; error: { message: string } | null };
export type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
};
export function rpcClient(supabase: unknown): RpcClient {
  return supabase as RpcClient;
}

// Stable signal for "the tenant_invitations migration is not applied to this project
// yet" so the UI can show a truthful pending state instead of a raw error.
export const INVITES_NOT_INSTALLED = "INVITES_NOT_INSTALLED";
export function asInvitationError(error: { message: string }): Error {
  return /Could not find the function|schema cache/.test(error.message)
    ? new Error(INVITES_NOT_INSTALLED)
    : new Error(error.message);
}
