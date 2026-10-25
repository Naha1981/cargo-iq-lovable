# Live-apply packet: tenant_invitations (20261025120000)

Status: PREPARED, NOT APPLIED. Live DB apply is owner-gated. This packet is
the exact change plus verification so approval is one decision, not research.

## Verified current state (25 Oct 2026, read-only anon probes against live)

- `GET /rest/v1/tenant_invitations` -> PGRST205 (table missing).
- `POST /rpc/list_tenant_invitations` -> PGRST202 (function missing).
- `GET /rest/v1/schema_migrations` -> PGRST205: live has no migration
  ledger, so live was provisioned outside the repo runner. A full
  repo-to-live drift audit is a separate task needing the live DB
  connection (owner-gated); this packet covers only tenant_invitations,
  which the app UI now calls (invitations page).

On staging the same migration applied cleanly (runner 38/38, drift 0) and
the RPC is behaviour-verified: own tenant returns rows, cross-tenant raises
SQLSTATE P0001 FORBIDDEN.

## The change

Exactly `supabase/migrations/20261025120000_tenant_invitations.sql` as
committed (c696675). Properties: email-binding accept (forwarded links grant
nothing), single-use + 7-day expiry, INSERT-only membership (an invitation
can never change an existing member's role), table RLS-enabled with NO
policies (all access through SECURITY DEFINER functions, repo-standard
REVOKE/GRANT hardening).

## Apply procedure (after approval)

1. Pre-damage dump of the live DB (pg_dump, stored outside the repo).
2. Run: `node scripts/db-migrate.mjs` with the live libpq env
   (PGHOST/PGPASSWORD...). The runner records per-file in schema_migrations,
   creating the ledger on first run - this also starts drift tracking.
3. Post-checks (anon key, read-only):
   - table probe returns permission-denied or rows-restricted (not PGRST205)
   - RPC probe returns FORBIDDEN/401 (not PGRST202)
   - signed-in non-admin on a real tenant: RPC returns FORBIDDEN (P0001)
4. Rollback if post-checks fail: `DROP FUNCTION` the five invitation
   functions, `DROP TABLE public.tenant_invitations`. Additive, no existing
   object is modified, so rollback is safe and complete.

## Risk notes

- Purely additive: new table + new functions. No existing table, policy, or
  function is altered.
- is_tenant_admin() is a new SECURITY DEFINER function, not a change to
  is_tenant_member().
- Invitations never email anyone by themselves; the accept link is copied
  manually by the admin (no outbound email grant needed for this change).
