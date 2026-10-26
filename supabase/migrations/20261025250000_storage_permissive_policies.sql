-- Storage permissive policies: version the live case-documents policies and
-- fix the deterministic cctv-evidence 42501.
--
-- Two gaps closed here (found 25 Oct, staging pg_policies ground truth):
-- 1. The live permissive policies "Tenant read case docs" and "Tenant upload
--    case docs" were created out-of-band and exist NOWHERE in this migration
--    set - a fresh rebuild from migrations alone cannot upload or read case
--    documents. They are versioned here verbatim (verified definitions),
--    drop+create so re-apply on the live DB is a no-op behavior change.
-- 2. The cctv-evidence bucket has NO permissive policy at all, so every
--    tenant-JWT storage call against it is denied 42501 (deterministic -
--    the calm single-tenant denial seen in the load baseline). The actual
--    broken user path is READING evidence: investigators open signed URLs
--    (createSignedUrl in cctv.functions.ts runs on the user's JWT). Evidence
--    WRITES come from the ingest route's service client, which bypasses RLS,
--    so NO tenant INSERT/UPDATE/DELETE policy is added for cctv-evidence:
--    tenant write access stays fail-closed, matching case-documents (no
--    tenant DELETE there either).
--
-- Owner-safe: additive + idempotent (drop policy if exists first). Nothing
-- is deleted, no roles change, no data moves.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('cargoiq-storage-permissive-v1',0));

DO $guard$
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'OWNER STEP STOPPED: storage.objects missing - wrong project? Nothing was changed';
  END IF;
  IF to_regclass('public.user_roles') IS NULL THEN
    RAISE EXCEPTION 'OWNER STEP STOPPED: user_roles missing - wrong project? Nothing was changed';
  END IF;
END $guard$;

-- 1. Versioned copies of the live case-documents policies (exact live shape).
drop policy if exists "Tenant read case docs" on storage.objects;
create policy "Tenant read case docs" on storage.objects
for select to authenticated
using (bucket_id = 'case-documents' and public.is_tenant_member((storage.foldername(name))[1]::uuid));

drop policy if exists "Tenant upload case docs" on storage.objects;
create policy "Tenant upload case docs" on storage.objects
for insert to authenticated
with check (bucket_id = 'case-documents' and public.is_tenant_member((storage.foldername(name))[1]::uuid));

-- 2. cctv-evidence: tenant members can READ their own tenant's evidence
-- objects (path convention <tenant_uuid>/<source>/<camera>/<observation>/<file>).
drop policy if exists "Tenant read cctv evidence" on storage.objects;
create policy "Tenant read cctv evidence" on storage.objects
for select to authenticated
using (bucket_id = 'cctv-evidence' and public.is_tenant_member((storage.foldername(name))[1]::uuid));

COMMIT;
SELECT 'storage_permissive_policies_applied' AS result,
  (SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
     AND policyname IN ('Tenant read case docs','Tenant upload case docs','Tenant read cctv evidence')) = 3
    AS all_three_present;
