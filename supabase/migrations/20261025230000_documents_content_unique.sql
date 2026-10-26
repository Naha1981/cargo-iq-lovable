-- REPAIR DRAFT v2 (uncommitted): atomic content ownership WITHOUT modifying
-- any documents row or the evidence guard. A companion ownership table holds
-- one row per (tenant, case, content hash); an AFTER INSERT trigger claims
-- ownership atomically for every new documents row. Historical duplicates are
-- backfilled deterministically (earliest uploaded_at, then id, is canonical)
-- and PRESERVED as evidence; no UPDATE/DELETE on documents anywhere.
-- The trigger raises SQLSTATE 23505 on a losing claim so the app's existing
-- 23505 contract (return the winner's row) holds unchanged, for historical
-- AND new content alike. NULL hashes are excluded, as before.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='120s';
SELECT pg_advisory_xact_lock(hashtextextended('cargoiq-documents-content-unique-v1',0));

CREATE TABLE IF NOT EXISTS public.document_content_ownership (
  tenant_id uuid NOT NULL,
  case_id uuid NOT NULL,
  sha256_hash text NOT NULL,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, case_id, sha256_hash)
);
REVOKE ALL ON public.document_content_ownership FROM anon, authenticated;
ALTER TABLE public.document_content_ownership ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_document_content_ownership() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.sha256_hash IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cargoiq-documents-content-unique-v1',0));
  INSERT INTO public.document_content_ownership (tenant_id, case_id, sha256_hash, document_id)
  VALUES (NEW.tenant_id, NEW.case_id, NEW.sha256_hash, NEW.id)
  ON CONFLICT (tenant_id, case_id, sha256_hash) DO NOTHING;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'documents_content_unique: content already owned by another documents row'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS documents_content_ownership_claim ON public.documents;
CREATE TRIGGER documents_content_ownership_claim AFTER INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.claim_document_content_ownership();

-- Deterministic backfill: earliest uploaded_at (then id) is canonical per group.
-- NULLS LAST is explicit: a row with unknown upload time never outranks a
-- known-earlier row for canonical ownership.
-- Advisory lock above serializes this against concurrent claim triggers.
INSERT INTO public.document_content_ownership (tenant_id, case_id, sha256_hash, document_id)
SELECT DISTINCT ON (tenant_id, case_id, sha256_hash) tenant_id, case_id, sha256_hash, id
FROM public.documents
WHERE sha256_hash IS NOT NULL
ORDER BY tenant_id, case_id, sha256_hash, uploaded_at ASC NULLS LAST, id
ON CONFLICT (tenant_id, case_id, sha256_hash) DO NOTHING;

DO $$
DECLARE v_groups integer; v_rows integer;
BEGIN
  SELECT count(*), coalesce(sum(n),0) INTO v_groups, v_rows FROM (
    SELECT count(*) AS n FROM public.documents
     WHERE sha256_hash IS NOT NULL
     GROUP BY tenant_id, case_id, sha256_hash HAVING count(*) > 1) d;
  IF v_groups > 0 THEN
    RAISE WARNING 'documents_content_unique: % pre-existing duplicate groups across % rows PRESERVED as evidence; canonical owner recorded in document_content_ownership (earliest uploaded_at)', v_groups, v_rows;
  END IF;
END $$;
COMMIT;
