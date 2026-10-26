# Feature audit and batch SQL

Approved and applied once to the separate CargoIQ test database on26October2026 after the revised complete-scope approval. Production remains unapplied/unpublished.
The local feature server functions now require `feature_atomic_audit.sql` together
with the three feature migrations. Do not deploy just the table migrations with
these functions: doing so would omit automatic audit history.

Proposed additional scope: one NEW trigger function, one NEW invoker batch RPC, four triggers on the four
NEW entity tables, removal of four insert policies on the four NEW audit tables.
No pre-feature tables or functions are altered. New function uses an empty
search_path, fully qualified objects, authenticated actor membership and creator
binding. It writes before/after records in the same transaction. Audit failure
aborts the parent write. Client audit insert/update/delete is disallowed.

Server functions do not insert duplicate audit rows. Recovery status updates use
compare-and-set; recovered confirmation and review note are retained in the
calculation record and therefore in the automatic audit. This is not a claim
that money receipt has been independently verified.

Proof: `node scripts/feature-rls-test.mjs` (12 assertions), then
`node scripts/feature-atomic-audit-test.mjs` (12 assertions). Both use isolated
PGlite in memory. No remote DB calls. Hosted PostgreSQL authenticated-role acceptance passed on26October2026. Browser login/save/reload acceptance remains open. Service-role/database-owner writes are privileged
and can bypass RLS, so this is not a cryptographic tamper-proof ledger.

Recovery comparison creation uses recovery_comparison_batch.sql: a new invoker
RPC, transaction-level advisory lock keyed by tenant+request UUID, deterministic
payload fingerprint, replay returns existing rows, differing payload under the
same key is refused. Invalid rows or audit storage failure roll back the whole
batch. Request key must be preserved on retries. Browser session storage preserves only payload SHA-256 and operation UUID, including
multiple uncertain payloads. Unit proof covers reuse; no authenticated crash/reload proof yet.

Production build remains unmet: WebGL-only package export condition attempted
with no dev/browser process and 1.4GB heap; still exhausted heap during Rollup.
The temporary export-condition config was reverted. No push used for CI.
