-- Unique invariant for upload object ownership (handover requirement: the
-- concurrent same-content race must be closed by the database, not by a
-- read-window query). One LIVE documents row per (tenant, case, content
-- hash): the committed row is the atomic proof of which upload attempt owns
-- the canonical object; the losing attempt's insert fails with 23505 and the
-- app returns the winner's row after reference-checked cleanup of its own
-- object. Deleted rows free the content for re-upload (index rows go with
-- them). NULL hashes (rows predating hashing) are excluded so they never
-- collide. Fails loudly, mid-transaction, if live duplicates already exist -
-- clean them up before re-applying; never dedupe silently.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='60s';
SELECT pg_advisory_xact_lock(hashtextextended('cargoiq-documents-content-unique-v1',0));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.documents
     WHERE sha256_hash IS NOT NULL
     GROUP BY tenant_id, case_id, sha256_hash
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'documents_content_unique: live duplicate (tenant_id, case_id, sha256_hash) rows exist; resolve them before applying this invariant';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS documents_tenant_case_sha256_uniq
  ON public.documents (tenant_id, case_id, sha256_hash)
  WHERE sha256_hash IS NOT NULL;

COMMIT;
