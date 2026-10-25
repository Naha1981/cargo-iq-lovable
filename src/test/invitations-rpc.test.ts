// Regression: the invitations server fns must call rpc as a BOUND method.
// supabase-js implements rpc as `this.rest.rpc(...)`; the previous code extracted
// the method into a bare variable, so every invite call threw
// "Cannot read properties of undefined (reading 'rest')" before any request.
import { describe, it, expect } from "vitest";
import { rpcClient, asInvitationError, INVITES_NOT_INSTALLED } from "@/lib/rpc-client";

// Mirrors the real supabase-js client: rpc only works when `this` is bound.
class FakeSupabase {
  rest = {
    calls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
    rpc(fn: string, args: Record<string, unknown>) {
      this.calls.push({ fn, args });
      return Promise.resolve({ data: { ok: true }, error: null });
    },
  };
  rpc(fn: string, args: Record<string, unknown>) {
    return this.rest.rpc(fn, args);
  }
}

describe("rpcClient binding", () => {
  it("calls rpc with the client bound as this (the live-bundle shape)", async () => {
    const fake = new FakeSupabase();
    const result = await rpcClient(fake).rpc("list_tenant_invitations", { p_tenant_id: "t1" });
    expect(result).toEqual({ data: { ok: true }, error: null });
    expect(fake.rest.calls).toEqual([
      { fn: "list_tenant_invitations", args: { p_tenant_id: "t1" } },
    ]);
  });

  it("proves the fake reproduces the original bug when rpc is extracted bare", async () => {
    const fake = new FakeSupabase();
    // supabase-js throws synchronously here; in the async server handler that
    // synchronous throw is what rejected every invite call on live.
    const bare: (fn: string, args: Record<string, unknown>) => unknown = fake.rpc;
    expect(() => bare("list_tenant_invitations", {})).toThrow(/'rest'/);
  });
});

describe("asInvitationError", () => {
  it("maps a missing-RPC PostgREST error to the stable INVITES_NOT_INSTALLED signal", () => {
    const err = asInvitationError({
      message:
        "Could not find the function public.list_tenant_invitations(p_tenant_id) in the schema cache",
    });
    expect(err.message).toBe(INVITES_NOT_INSTALLED);
  });
  it("passes through real errors unchanged", () => {
    expect(asInvitationError({ message: "only tenant admins can invite" }).message).toBe(
      "only tenant admins can invite",
    );
  });
});
