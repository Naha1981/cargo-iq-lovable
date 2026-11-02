-- The deployed claim schema has no event_reference column. Direct record access
-- made every review fail with 42703. Compare optional fields as JSONB instead.
-- All immutability and reviewed-status locks are preserved, no records changed.
BEGIN;
SET LOCAL lock_timeout='10s';
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
       OR (to_jsonb(NEW)->'event_reference') IS DISTINCT FROM (to_jsonb(OLD)->'event_reference')
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

COMMIT;
