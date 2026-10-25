-- Evidence integrity guards: close investigator tamper paths found in audit.
-- Preserves legitimate flows: claim review (status only), contradiction resolution,
-- PENDING-only re-extraction cleanup, document extraction_status updates, pack creation.
-- Additive triggers only; no data changed, no roles or invites touched.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='60s';
SELECT pg_advisory_xact_lock(hashtextextended('cargoiq-evidence-immutability-v1',0));

CREATE OR REPLACE FUNCTION public.guard_evidence_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF TG_TABLE_NAME='documents' THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'EVIDENCE_DOCUMENT_DELETE_BLOCKED'; END IF;
    IF NEW.sha256_hash IS DISTINCT FROM OLD.sha256_hash
       OR NEW.file_path IS DISTINCT FROM OLD.file_path
       OR NEW.name IS DISTINCT FROM OLD.name
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
       OR NEW.case_id IS DISTINCT FROM OLD.case_id THEN
      RAISE EXCEPTION 'EVIDENCE_DOCUMENT_CONTENT_IMMUTABLE';
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME='extracted_claims' THEN
    IF TG_OP='DELETE' THEN
      -- Re-extraction may drop still-unverified claims only.
      IF OLD.status='PENDING' THEN RETURN OLD; END IF;
      RAISE EXCEPTION 'EVIDENCE_CLAIM_DELETE_BLOCKED';
    END IF;
    -- Review may change only the verification status.
    IF NEW.claim_text IS DISTINCT FROM OLD.claim_text
       OR NEW.claim_type IS DISTINCT FROM OLD.claim_type
       OR NEW.normalized_value IS DISTINCT FROM OLD.normalized_value
       OR NEW.evidence_class IS DISTINCT FROM OLD.evidence_class
       OR NEW.nature IS DISTINCT FROM OLD.nature
       OR NEW.timestamp_claimed IS DISTINCT FROM OLD.timestamp_claimed
       OR NEW.event_reference IS DISTINCT FROM OLD.event_reference
       OR NEW.document_id IS DISTINCT FROM OLD.document_id
       OR NEW.case_id IS DISTINCT FROM OLD.case_id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'EVIDENCE_CLAIM_CONTENT_IMMUTABLE';
    END IF;
    IF OLD.status IN ('VERIFIED','DISPUTED') AND NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION 'EVIDENCE_CLAIM_REVIEWED_STATUS_LOCKED';
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME='contradictions' THEN
    IF TG_OP='DELETE' THEN
      -- Re-extraction cleanup drops open flags tied to replaced PENDING claims only.
      IF OLD.status='FLAGGED' THEN RETURN OLD; END IF;
      RAISE EXCEPTION 'EVIDENCE_CONTRADICTION_DELETE_BLOCKED';
    END IF;
    -- Resolution path sets status + resolution fields only.
    IF NEW.claim_a_id IS DISTINCT FROM OLD.claim_a_id
       OR NEW.claim_b_id IS DISTINCT FROM OLD.claim_b_id
       OR NEW.case_id IS DISTINCT FROM OLD.case_id
       OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'EVIDENCE_CONTRADICTION_CONTENT_IMMUTABLE';
    END IF;
    IF OLD.status='RESOLVED' THEN RAISE EXCEPTION 'EVIDENCE_CONTRADICTION_RESOLUTION_LOCKED'; END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME='timeline_events' THEN
    IF TG_OP='DELETE' THEN
      -- Allowed only while the provenance claim is still PENDING (re-extraction cleanup).
      IF OLD.provenance_id IS NOT NULL AND EXISTS(
        SELECT 1 FROM public.extracted_claims c WHERE c.id=OLD.provenance_id AND c.status='PENDING'
      ) THEN RETURN OLD; END IF;
      RAISE EXCEPTION 'EVIDENCE_TIMELINE_DELETE_BLOCKED';
    END IF;
    RAISE EXCEPTION 'EVIDENCE_TIMELINE_UPDATE_BLOCKED';
  ELSIF TG_TABLE_NAME IN ('external_observations','financial_calculations') THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'EVIDENCE_%_DELETE_BLOCKED', upper(TG_TABLE_NAME); END IF;
    RAISE EXCEPTION 'EVIDENCE_%_UPDATE_BLOCKED', upper(TG_TABLE_NAME);
  ELSIF TG_TABLE_NAME='audit_log' THEN
    RAISE EXCEPTION 'AUDIT_LOG_APPEND_ONLY';
  END IF;
  RETURN NULL;
END $$;

DO $guard$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['documents','extracted_claims','contradictions','timeline_events','external_observations','financial_calculations','audit_log'] LOOP
    IF to_regclass('public.'||t) IS NULL THEN RAISE EXCEPTION 'Core table % missing',t; END IF;
    -- Verify-or-abort idempotency: an existing guard must be exactly ours
    -- (function name + body hash), never silently trusted by name alone.
    IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=('public.'||t)::regclass AND tgname='evidence_immutable_guard' AND NOT tgisinternal) THEN
      IF NOT EXISTS(SELECT 1 FROM pg_trigger tg JOIN pg_proc fp ON fp.oid=tg.tgfoid
                    WHERE tg.tgrelid=('public.'||t)::regclass AND tg.tgname='evidence_immutable_guard' AND NOT tg.tgisinternal
                      AND fp.proname='guard_evidence_immutable' AND md5(fp.prosrc)='6e0b8b78fd9f106475274938d228a7fe') THEN
        RAISE EXCEPTION 'evidence_immutable_guard on % exists with an unexpected definition - inspect before continuing', t;
      END IF;
    ELSE
      EXECUTE format('CREATE TRIGGER evidence_immutable_guard BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_evidence_immutable()',t);
    END IF;
  END LOOP;
END $guard$;

-- Cross-tenant case reference guard: row tenant must own the referenced case.
-- Closes the direct-REST path that application-level checks cannot cover.
CREATE OR REPLACE FUNCTION public.guard_case_tenant_match() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF NEW.case_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.cases c WHERE c.id=NEW.case_id AND c.tenant_id=NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'CASE_TENANT_MISMATCH';
  END IF;
  RETURN NEW;
END $$;

DO $casefk$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['documents','extracted_claims','contradictions','timeline_events','external_observations','financial_calculations','evidence_packs','audit_log'] LOOP
    IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=('public.'||t)::regclass AND tgname='case_tenant_match_guard' AND NOT tgisinternal) THEN
      IF NOT EXISTS(SELECT 1 FROM pg_trigger tg JOIN pg_proc fp ON fp.oid=tg.tgfoid
                    WHERE tg.tgrelid=('public.'||t)::regclass AND tg.tgname='case_tenant_match_guard' AND NOT tg.tgisinternal
                      AND fp.proname='guard_case_tenant_match' AND md5(fp.prosrc)='e67b5a6614706515746504e8b1f8a551') THEN
        RAISE EXCEPTION 'case_tenant_match_guard on % exists with an unexpected definition - inspect before continuing', t;
      END IF;
    ELSE
      EXECUTE format('CREATE TRIGGER case_tenant_match_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_case_tenant_match()',t);
    END IF;
  END LOOP;
END $casefk$;

-- Case rows with frozen evidence packs must not be deleted (pack provenance would dangle).
CREATE OR REPLACE FUNCTION public.guard_case_delete_with_packs() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.evidence_packs p WHERE p.case_id=OLD.id) THEN
    RAISE EXCEPTION 'CASE_HAS_EVIDENCE_PACKS_DELETE_BLOCKED';
  END IF;
  RETURN OLD;
END $$;

DO $caseguard$
BEGIN
  IF to_regclass('public.cases') IS NULL OR to_regclass('public.evidence_packs') IS NULL THEN
    RAISE EXCEPTION 'cases/evidence_packs missing; inspect before apply';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.cases'::regclass AND tgname='case_pack_delete_guard' AND NOT tgisinternal) THEN
    IF NOT EXISTS(SELECT 1 FROM pg_trigger tg JOIN pg_proc fp ON fp.oid=tg.tgfoid
                  WHERE tg.tgrelid='public.cases'::regclass AND tg.tgname='case_pack_delete_guard' AND NOT tg.tgisinternal
                    AND fp.proname='guard_case_delete_with_packs' AND md5(fp.prosrc)='d660757e0bd3990f13e3b551f62250bb') THEN
      RAISE EXCEPTION 'case_pack_delete_guard exists with an unexpected definition - inspect before continuing';
    END IF;
  ELSE
    CREATE TRIGGER case_pack_delete_guard BEFORE DELETE ON public.cases FOR EACH ROW EXECUTE FUNCTION public.guard_case_delete_with_packs();
  END IF;
END $caseguard$;

COMMIT;
SELECT 'evidence_immutability_guards_applied' AS result,
 (SELECT count(*) FROM pg_trigger WHERE tgname='evidence_immutable_guard' AND NOT tgisinternal)=7 AS table_guards,
 (SELECT count(*) FROM pg_trigger WHERE tgname='case_pack_delete_guard' AND NOT tgisinternal)=1 AS case_guard,
 (SELECT count(*) FROM pg_trigger WHERE tgname='case_tenant_match_guard' AND NOT tgisinternal)=8 AS case_tenant_guards;
