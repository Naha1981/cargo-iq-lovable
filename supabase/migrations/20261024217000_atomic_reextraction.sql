-- Atomic re-extraction (audit item 10): replacing a document's PENDING claims
-- used to be three separate delete calls plus a per-claim insert loop from the
-- app. A crash mid-way left the case with half-replaced evidence. This RPC does
-- the cleanup + claim inserts + provenance timeline rows in one transaction.
-- Runs under the live evidence guards: PENDING claim deletes, FLAGGED
-- contradiction deletes and PENDING-provenance timeline deletes are exactly the
-- flows guard_evidence_immutable permits. SECURITY INVOKER: caller's RLS applies
-- and the caller must be admin/investigator of the case's tenant.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='60s';
SELECT pg_advisory_xact_lock(hashtextextended('cargoiq-atomic-reextraction-v1',0));

CREATE OR REPLACE FUNCTION public.replace_pending_claims(
  _case_id uuid, _document_id uuid, _claims jsonb, _replace_pending boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE
  v_tenant uuid; v_pending uuid[]; v_claim jsonb;
  v_row public.extracted_claims%ROWTYPE; v_inserted jsonb := '[]'::jsonb;
  v_seq int := 0; v_has_seq boolean; v_norm jsonb; v_class text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  SELECT tenant_id INTO v_tenant FROM public.cases WHERE id = _case_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'CASE_NOT_FOUND'; END IF;
  -- Same role source the CCTV RESTRICTIVE policies and app role checks use.
  IF NOT EXISTS(SELECT 1 FROM public.user_roles r
    WHERE r.user_id = auth.uid() AND r.tenant_id = v_tenant AND r.role IN ('admin','investigator')) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.documents WHERE id = _document_id AND case_id = _case_id) THEN
    RAISE EXCEPTION 'DOCUMENT_NOT_FOUND';
  END IF;
  IF jsonb_typeof(_claims) <> 'array' THEN RAISE EXCEPTION 'CLAIMS_MUST_BE_ARRAY'; END IF;

  IF _replace_pending THEN
    SELECT coalesce(array_agg(id), '{}') INTO v_pending FROM public.extracted_claims
      WHERE case_id = _case_id AND document_id = _document_id AND status = 'PENDING';
    IF array_length(v_pending, 1) IS NOT NULL THEN
      -- Retention: record exactly what is being replaced in append-only audit_log BEFORE
      -- deleting, so the case's evidence history stays reconstructable even though the
      -- unverified claims themselves go away. Sealed packs already snapshot their claims;
      -- this row is the register-level record of the replacement. The audit_actor_guard
      -- requires authenticated inserts to name the caller, which auth.uid() satisfies.
      -- Full-fidelity record: the complete claim rows (every evidence column), the
      -- contradiction relationships being removed, and the timeline provenance rows
      -- being removed, so the pre-replacement state is fully reconstructable against
      -- the source document (documents row + storage file are untouched by re-extraction).
      INSERT INTO public.audit_log(tenant_id, case_id, actor_user_id, action, entity_type, entity_id, payload)
      SELECT v_tenant, _case_id, auth.uid(), 'REEXTRACTION_REPLACED_PENDING', 'document', _document_id,
             jsonb_build_object(
               'replaced_claims', (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.created_at), '[]'::jsonb)
                                     FROM public.extracted_claims c WHERE c.id = ANY(v_pending)),
               'removed_contradictions', (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
                                     FROM public.contradictions x WHERE x.case_id = _case_id AND x.status = 'FLAGGED'
                                       AND (x.claim_a_id = ANY(v_pending) OR x.claim_b_id = ANY(v_pending))),
               'removed_provenance', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
                                     FROM public.timeline_events t WHERE t.provenance_id = ANY(v_pending)));
      DELETE FROM public.timeline_events WHERE provenance_id = ANY(v_pending);
      DELETE FROM public.contradictions WHERE case_id = _case_id AND status = 'FLAGGED'
        AND (claim_a_id = ANY(v_pending) OR claim_b_id = ANY(v_pending));
      DELETE FROM public.extracted_claims WHERE id = ANY(v_pending);
    END IF;
  END IF;

  SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='extracted_claims' AND column_name='source_seq') INTO v_has_seq;

  FOR v_claim IN SELECT * FROM jsonb_array_elements(_claims) LOOP
    v_seq := v_seq + 1;
    v_norm := CASE WHEN v_claim ? 'event_reference'
      THEN jsonb_build_object('source_value', v_claim->'normalized_value', 'event_reference', v_claim->>'event_reference')
      ELSE v_claim->'normalized_value' END;
    IF v_has_seq THEN
      INSERT INTO public.extracted_claims
        (tenant_id, case_id, document_id, page_number, claim_text, claim_type, normalized_value,
         evidence_class, nature, status, confidence, timestamp_claimed, source_seq)
      VALUES (v_tenant, _case_id, _document_id,
        (v_claim->>'page_number')::int, v_claim->>'claim_text', v_claim->>'claim_type', v_norm,
        v_claim->>'evidence_class', v_claim->>'nature', 'PENDING',
        coalesce((v_claim->>'confidence')::numeric, 0.7), (v_claim->>'timestamp_claimed')::timestamptz, v_seq)
      RETURNING * INTO v_row;
    ELSE
      INSERT INTO public.extracted_claims
        (tenant_id, case_id, document_id, page_number, claim_text, claim_type, normalized_value,
         evidence_class, nature, status, confidence, timestamp_claimed)
      VALUES (v_tenant, _case_id, _document_id,
        (v_claim->>'page_number')::int, v_claim->>'claim_text', v_claim->>'claim_type', v_norm,
        v_claim->>'evidence_class', v_claim->>'nature', 'PENDING',
        coalesce((v_claim->>'confidence')::numeric, 0.7), (v_claim->>'timestamp_claimed')::timestamptz)
      RETURNING * INTO v_row;
    END IF;
    v_inserted := v_inserted || jsonb_build_object('id', v_row.id, 'claim_text', v_row.claim_text);
    IF v_row.timestamp_claimed IS NOT NULL THEN
      INSERT INTO public.timeline_events
        (tenant_id, case_id, "timestamp", title, source, evidence_class, nature, provenance_id)
      VALUES (v_tenant, _case_id, v_row.timestamp_claimed, v_row.claim_text,
        v_claim->>'source_name', v_row.evidence_class, v_row.nature, v_row.id);
    END IF;
  END LOOP;
  RETURN v_inserted;
END $$;
REVOKE ALL ON FUNCTION public.replace_pending_claims(uuid, uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_pending_claims(uuid, uuid, jsonb, boolean) TO authenticated;
COMMIT;
SELECT 'atomic_reextraction_applied' AS result;
