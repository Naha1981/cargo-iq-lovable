# CargoIQ database operations (engineering)

Owner-facing steps live in docs/OWNER-RUNBOOK.md. This document is the operator
reference: how the schema is versioned, how to rebuild a project from zero, and
how backup/restore actually works on Supabase free tier. Every procedure here was
executed and measured on the cargoiq-staging project on 25 Oct 2026.

## 1. Migration versioning: scripts/db-migrate.mjs

The schema is NOT one migration. It is two layers applied in this exact order:

1. `drizzle/migrations/*.sql` (base: app_role enum, 12 core tables, is_tenant_member,
   RLS, grants, provision_organization, storage policies)
2. `supabase/migrations/*.sql` (chronological by filename)

The `supabase/migrations` files alone CANNOT build a blank database: the earliest
file references tables only the drizzle base creates.

`scripts/db-migrate.mjs` applies both layers in order and records each applied
file with its SHA-256 in `public.schema_migrations`:

    node scripts/db-migrate.mjs status     # applied vs pending vs drift
    node scripts/db-migrate.mjs apply      # apply pending files only (safe to re-run)
    node scripts/db-migrate.mjs from-zero  # apply everything; refuses unless public has no user tables
    node scripts/db-migrate.mjs adopt      # record all files as applied without running them
                                           # (only for databases already built by hand, e.g. Lovable-created prod)

Rules:
- Migrations are append-only. A changed already-applied file is DRIFT: the runner
  prints it and exits 1. Fix forward with a new migration, never edit history.
- One transaction per file; a failed file rolls back and stops the run.
- Target must be the default `postgres` database of a Supabase project. Other
  databases on the same instance lack the auth/storage schemas and platform
  roles; "from-zero" means zero USER tables in public, not a bare instance.
- Connection via standard libpq env (PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD/
  PGSSLMODE). psql must match the server major version (17.x today - see §3).
- Supabase free-tier direct host is IPv6-only. From networks without IPv6 use the
  session pooler: PGHOST=aws-0-<region>.pooler.supabase.com PGPORT=5432
  PGUSER=postgres.<project-ref>.

Verified on staging (25 Oct): full from-zero E2E through the runner on the wiped
default postgres database (drop/create schema public -> runner applied 38/38 ->
45 tables incl. schema_migrations, 44 RLS-enabled, 130 public policies, 5 storage
policies, buckets survive in the storage schema). Also verified: adopt of an
already-built database, status, idempotent re-apply (safe after interrupted runs:
each file commits separately and is recorded before the next starts), from-zero
refusal on a populated DB, drift detection on a tampered checksum (exit 1).
Known output quirk: files that wrap themselves in BEGIN...COMMIT print a harmless
"there is no transaction in progress" warning under the runner's per-file
single-transaction mode.

## 2. Rebuild a fresh staging/QA project from zero

1. Create a FREE Supabase project in the nahalabs org (no GitHub connect).
2. Generate a DB password; store it in the vault only.
3. `PGDATABASE=postgres ... node scripts/db-migrate.mjs from-zero`
4. Verify: 44 public tables, all RLS-enabled; `node scripts/db-migrate.mjs status`
   shows applied=38 pending=0 drift=0.
5. Storage buckets are NOT in migrations: create `case-documents` (private) via
   dashboard or `insert into storage.buckets(id,name,public) values
   ('case-documents','case-documents',false);`

## 3. Backup

Scope limit - a dump of the public schema is NOT a full backup:

| Covered (pg_dump -n public)      | NOT covered                                   |
| -------------------------------- | --------------------------------------------- |
| tables, data, RLS, functions,    | auth users/orgs (Supabase Auth)               |
| grants, triggers, sequences      | storage file bytes (uploaded documents)       |
|                                  | storage buckets + storage.objects policies    |
|                                  | platform default privileges of other roles    |

Command (needs pg_dump 17.x; older clients refuse server 17):

    pg_dump "<pooler conninfo>" -n public -Fc -f cargoiq-public-YYYYMMDD.dump

Supabase free tier has no scheduled backups - this dump is the only recovery
source, so cadence and storage location matter. Uploaded document bytes need a
separate copy strategy (open gap, see §5).

## 4. Restore (measured 25 Oct on staging)

Do NOT use `pg_restore --clean` in place: dependency-ordered drops fail on
cross-referencing objects, data duplicates where drops fail, and RLS/policies
are lost mid-restore. Measured working method:

1. `drop schema public cascade; create schema public;`
   (cascade also drops storage.objects policies that reference public functions)
2. `pg_restore -d <conn> -n public --no-owner --section=pre-data dump` (measured 37s)
3. `pg_restore -d <conn> -n public --no-owner --section=data dump` (measured ~2s)
4. `pg_restore -d <conn> -n public --no-owner --section=post-data --jobs=4 dump` (measured 26s)
   - expect "permission denied to change default privileges" errors for other
     roles' defaults; verify equivalence after (all 24 dump default-privilege
     statements had live counterparts on staging; platform defaults regenerate)
5. Re-apply storage policies from the repo: drizzle/migrations/0001 and the
   investigator_case_documents_* block of
   supabase/migrations/20261016063000_core_viewer_readonly_guard.sql (storage
   policies are outside the public dump)
6. Re-grant schema access: `grant usage on schema public to anon, authenticated,
   service_role;` plus default privileges for future tables
7. Recreate storage buckets if dropped (§2 step 5)
8. Verify before declaring recovered: table count, RLS-enabled count, policy
   count (130 public + 5 storage), row counts, FK constraints, then re-run the
   tenant-isolation spot checks (own rows visible, cross-tenant invisible,
   cross-tenant write denied).

Measured total for steps 2-6 on staging: ~125s.

## 5. Acceptance-gap ledger (as of 25 Oct 2026, commit 838de6f)

| Criterion (owner handover 10:58) | Status | Evidence |
| --- | --- | --- |
| CI gate (lint/vuln + DB integration) | PARTIAL: CI green (tsc, 294 tests, 10 DB scripts, build); eslint = 192 no-explicit-any backlog, 0 other; npm audit 4 moderate dev-only | CI run 40191254419 |
| Two-tenant isolation on staging | DB-level + REAL-JWT API PROVEN (GoTrue-issued JWTs for 3 synthetic users: own-tenant reads, cross-tenant reads empty, cross-tenant INSERT 42501, viewer INSERT denied by investigator_core_insert, viewer UPDATE/DELETE no-op, documents/packs/storage cross-tenant empty, storage folder write denial; re-passed after runner from-zero rebuild). Browser-UI two-signed-in-tenant proof OPEN (needs a staging frontend deploy) | staging API checks 25 Oct |
| Reproducible from zero | PROVEN E2E via runner on wiped default DB (38/38) + original manual file-by-file apply on blank project | §1, §2 |
| Restore drill | PROVEN with documented method + scope limits | §3, §4 |
| Config not code | OPEN | - |
| 50-tenant concurrent capacity vs agreed response time | OPEN (no agreed target number recorded yet) | - |
| Graceful degradation + daily AI health email | PARTIAL: team panel degrades truthfully (838de6f); health email OPEN | - |
| Rate limits + upload size + per-tenant caps | PARTIAL: caps exist (admin panel + RPCs); rate/upload limits review OPEN | - |
| Owner runbook | EXISTS (39 lines, owner-safe) | docs/OWNER-RUNBOOK.md |
| Honest README/roadmap | OPEN (needs this ledger merged) | - |
| tenant_invitations on LIVE DB | NOT APPLIED (needs owner approval); UI shows truthful pending state meanwhile | migration 20261025120000 |
| Storage file-bytes backup | OPEN (§3 scope) | - |
