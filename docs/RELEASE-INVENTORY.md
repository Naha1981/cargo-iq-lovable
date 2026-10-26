# CargoIQ release inventory + migration dependency review (25 Oct 2026, 19:10 SAST)

## Deployed state (verified 19:02-19:07 SAST, public reads only)

- Production https://cargoiq.nahalabs.co.za: bundle flipped at the user's
  19:01 publish (14:08-captured assets now 404; new assets serve). STRONG
  SUSPICION, not proof, that the deployed build predates 774e484: the only
  anonymously observable runtime delta in the batch is the report-only CSP
  header, which is absent on live - but host-level filtering of report-only
  headers as a class cannot be excluded, so this is not decisive. The batch's
  client-code changes are type-level (non-discriminative by construction).
  Settling the deployed commit needs the owning Lovable session (project
  GitHub-sync state / publish history).
- origin/main: 774e484 (30-commit batch, pushed 16:04, CI green run
  40200526429 - at THAT revision: 302 unit tests + 10 DB scripts).

## Local, unpushed, unapproved (12 commits over origin/main)

| commit | content | migrations |
|---|---|---|
| cb45ad2 | upload backpressure lib | - |
| e4588f1 | in-app AI health report | 20261025210000 |
| 22b6a6a | 15:46-review fixes | - |
| b395f4b | safe-claim removal, reference-safe cleanup, app_errors retention | - |
| 91d255b | AdminAiHealthPanel + fixture pixel harness | - |
| c6b7634 | upload admission semaphore | 20261025220000 |
| 78189f0 | unique object-ownership invariant (23505 winner path) | 20261025230000 |
| 4e65cec | health-email send path (disabled) | - |
| 337298d | /api/health-email scheduled invocation (disabled-safe) | - |
| 58c2d32 | atomic day claim + provider idempotency | 20261025240000 |
| 8b9f761 | owner-visible delivery panel + sent_confirmation_failed | - |
| (new) | storage permissive policies versioned + cctv read fix, 50-tenant harness, wording corrections | 20261025250000 |

Local gates at HEAD: eslint 0 errors (7 accepted react-refresh warnings),
tsc clean, 331 unit + 1 skipped, 15 PGlite DB scripts, build green. CI runs
the same gates per push.

## Migrations in the local batch - dependency review

Apply order = filename order. All code-prep only, applied NOWHERE (not
staging, not production). All owner-safe: additive, idempotent where
re-appliable, guarded with wrong-project stops.

1. 20261025210000_admin_ai_health.sql - admin_get_ai_health RPC (platform
   admins + service_role). Depends on: documents, app_errors,
   free_extraction_attempts, is_platform_admin (20261024219000), auth.jwt
   (platform). No dependency on any other local migration.
2. 20261025220000_upload_admission.sql - upload_lease table + acquire /
   verify / release RPCs + per-tenant concurrency settings. Depends on:
   tenants, user_roles, is_platform_admin, auth.uid. Independent.
3. 20261025230000_documents_content_unique.sql - partial unique index
   (tenant_id, content_hash) on documents where content_hash is not null.
   Depends on: documents.content_hash existing. Independent.
4. 20261025240000_health_email_day_claim.sql - health_email_sends table +
   claim/complete/fail RPCs + admin_list_health_email_sends. Depends on:
   is_platform_admin, auth.jwt. Independent of 210000 except the endpoint
   code calls BOTH (report + claim) - either can be applied alone safely.
5. 20261025250000_storage_permissive_policies.sql - versions the live
   case-documents permissive policies (drop+create, same names and shape as
   verified on staging) + adds tenant-prefix SELECT for cctv-evidence.
   Depends on: storage.objects/buckets (platform), public.is_tenant_member,
   storage.foldername (platform helper). Idempotent; safe to re-apply.

## Fresh-rebuild fidelity review

- RESOLVED AS NEVER-BROKEN: the base schema (app_role, 12 base tables, base
  policies, is_tenant_member, guard_evidence_pack + trigger, seed_demo_case,
  provision_organization) is versioned in drizzle/migrations/0000_cargoiq_core.sql
  - layer 1 of scripts/db-migrate.mjs (drizzle/migrations then
  supabase/migrations). The supabase/migrations directory alone was never the
  complete set (docs/DB-OPERATIONS.md S1 states this). An earlier note in this
  review claimed is_tenant_member was unversioned; that checked only
  supabase/migrations and was wrong. scripts/fresh-rebuild-test.mjs now gates
  the runner's exact two-layer order: all 43 files apply from zero and the
  rebuilt public schema matches live object-for-object (only diffs:
  runner-owned schema_migrations; objects of the 5 unapplied code-prep
  migrations). The 38/38 staging from-zero E2E in docs/DB-OPERATIONS.md was
  the same two-layer runner proof (38 files at the time) and stands. Its
  scope: proven on the wiped STAGING default database; production rebuild has
  never been attempted or verified (no production DB access exists here).
- The case-documents permissive storage policies were versioned in
  drizzle/migrations/0001_case_documents_policies.sql (runner layer 1);
  20261025250000 additionally versions them in supabase/migrations with the
  cctv-evidence tenant SELECT fix (drop+create, identical definitions).
- Timed restore proof (docs/DB-OPERATIONS.md) covered the PUBLIC SCHEMA ONLY:
  auth users and storage bytes are out of its scope. The "fresh rebuild +
  timed restore" acceptance item is proven for the public schema, not as a
  full-environment restore.

## Outstanding owner decisions (unchanged)

1. Push approval (Go+Sure) for the 13-commit local batch.
2. Live-apply approval for migrations 210000-250000 (owner SQL step per
   runbook).
3. Publish: owning Lovable account sign-in grant (16:13 ask, still pending)
   OR user re-publishes after the editor shows the synced 774e484.
4. service_role vault grant to finish the 50-tenant seed (35/50 seeded).
5. Health email go-live: enable grant + recipient + RESEND_API_KEY env +
   cron wiring.
6. 50-concurrent run go + SLO: harness ready (scripts/load-50-tenants.mjs);
   suggested starting target upload p95 < 2000ms at 50 concurrent is
   PROPOSED from the measured baseline, not agreed.
7. Extraction-under-load: the free Gemini rail is the intended path
   (public_synthetic synthetic docs, testing-only key; models.list returned
   200 with the configured models available). NOT yet grounded as no-charge:
   models.list proves key validity only - remaining free-tier quota is not
   API-readable and billing linkage of the owning Google project is an
   owner-side account property. No AI run until the owner grounds no-charge.
