-- Reviewed follow-up: atomic evidence-pack persistence and approval.
-- Does not bypass existing clock/contradiction/role gates or rewrite any historical pack.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='60s';
SELECT pg_advisory_xact_lock(hashtextextended('cargoiq-atomic-evidence-packs-v1',0));
DO $preflight$
BEGIN
 IF to_regprocedure('public.has_unresolved_operational_clocks(uuid)') IS NULL
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.evidence_packs'::regclass AND tgname='operational_evidence_gate' AND NOT tgisinternal)
 THEN RAISE EXCEPTION 'Operational migration prerequisites missing'; END IF;
 IF to_regprocedure('public.persist_evidence_pack_atomic(uuid,text)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='evidence_packs' AND column_name='canonical_payload')
 THEN RAISE EXCEPTION 'Atomic pack feature already exists or partial deployment; inspect before retry'; END IF;
END $preflight$;
-- Preserve original role/clock/flag gate and add explicit case/tenant integrity.
CREATE OR REPLACE FUNCTION public.enforce_operational_evidence_gate() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND tenant_id=NEW.tenant_id AND role IN ('admin','investigator')) THEN RAISE EXCEPTION 'Investigator access required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cases WHERE id=NEW.case_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'Case tenant mismatch'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('case-evidence:'||NEW.case_id::text,0));
 IF public.has_unresolved_operational_clocks(NEW.case_id) OR EXISTS(SELECT 1 FROM public.contradictions WHERE case_id=NEW.case_id AND status='FLAGGED') THEN RAISE EXCEPTION 'BLOCKED: reconcile unresolved clock evidence and contradictions first'; END IF;
 RETURN NEW;
END $$;
ALTER TABLE public.evidence_packs ADD COLUMN canonical_payload text;
COMMENT ON COLUMN public.evidence_packs.canonical_payload IS 'Exact immutable UTF-8 hash input for new atomic-RPC packs; legacy rows remain NULL and unchanged.';
-- Every snapshot-source write participates in the same case lock as clock and money gates.
CREATE FUNCTION public.lock_pack_source_case() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE old_case uuid;new_case uuid;v uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN old_case:=(to_jsonb(OLD)->>CASE WHEN TG_TABLE_NAME='cases' THEN 'id' ELSE 'case_id' END)::uuid; END IF;
 IF TG_OP<>'DELETE' THEN new_case:=(to_jsonb(NEW)->>CASE WHEN TG_TABLE_NAME='cases' THEN 'id' ELSE 'case_id' END)::uuid; END IF;
 FOR v IN SELECT DISTINCT x FROM unnest(ARRAY[old_case,new_case]) x WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('case-evidence:'||v::text,0));
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DO $locks$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['cases','documents','extracted_claims','contradictions','timeline_events','external_observations','financial_calculations','operational_definitions','operational_clocks','appointment_attributions','kpi_definitions','cross_party_matches','evidence_gap_entries','cross_party_match_reviews','clock_reconciliations'] LOOP
  EXECUTE format('CREATE TRIGGER a0_pack_source_case_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.lock_pack_source_case()',t);
 END LOOP;
END $locks$;
-- Normalize only top-level register arrays by immutable id; preserve nested source order.
CREATE FUNCTION public.normalize_pack_source(_source jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=public AS $$
 SELECT jsonb_object_agg(key,CASE WHEN jsonb_typeof(value)='array' THEN
  coalesce((SELECT jsonb_agg(v ORDER BY v->>'id') FROM jsonb_array_elements(value) v),'[]'::jsonb)
 ELSE value END) FROM jsonb_each(_source)
$$;
CREATE FUNCTION public.current_pack_source(_case_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT jsonb_build_object(
  'case',(SELECT to_jsonb(c) FROM public.cases c WHERE id=_case_id),
  'documents',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.documents r WHERE case_id=_case_id),'[]'::jsonb),
  'operationalDefinitions',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.operational_definitions r WHERE case_id=_case_id),'[]'::jsonb),
  'operationalClocks',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.operational_clocks r WHERE case_id=_case_id),'[]'::jsonb),
  'appointmentAttributions',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.appointment_attributions r WHERE case_id=_case_id),'[]'::jsonb),
  'kpiDefinitions',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.kpi_definitions r WHERE case_id=_case_id),'[]'::jsonb),
  'crossPartyMatches',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.cross_party_matches r WHERE case_id=_case_id),'[]'::jsonb),
  'evidenceGapHistory',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.evidence_gap_entries r WHERE case_id=_case_id),'[]'::jsonb),
  'eventIdentityReviews',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.cross_party_match_reviews r WHERE case_id=_case_id),'[]'::jsonb),
  'clockReconciliations',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.clock_reconciliations r WHERE case_id=_case_id),'[]'::jsonb),
  'claims',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.extracted_claims r WHERE case_id=_case_id),'[]'::jsonb),
  'contradictions',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.contradictions r WHERE case_id=_case_id),'[]'::jsonb),
  'timeline',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.timeline_events r WHERE case_id=_case_id),'[]'::jsonb),
  'externalObservations',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.external_observations r WHERE case_id=_case_id),'[]'::jsonb),
  'financialCalculations',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.financial_calculations r WHERE case_id=_case_id),'[]'::jsonb),
  'verifiedClaims',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.extracted_claims r WHERE case_id=_case_id AND status='VERIFIED'),'[]'::jsonb),
  'approvals','[]'::jsonb,
  'truthRule','Public and independent observations are corroboration unless the source directly proves the event. Inference remains inference until human review.'
 )
$$;
-- New canonical bytes are immutable, just like existing payload/hash/version.
CREATE FUNCTION public.guard_pack_canonical() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.canonical_payload IS DISTINCT FROM OLD.canonical_payload THEN RAISE EXCEPTION 'EVIDENCE_PACK_CANONICAL_IMMUTABLE'; END IF;
 IF NEW.canonical_payload IS NOT NULL AND (NEW.canonical_payload::jsonb IS DISTINCT FROM NEW.pack_payload
  OR encode(sha256(convert_to(NEW.canonical_payload,'UTF8')),'hex') IS DISTINCT FROM NEW.sha256_hash) THEN RAISE EXCEPTION 'EVIDENCE_PACK_HASH_MISMATCH'; END IF;
 IF NEW.status='APPROVED' AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'APPROVED') THEN
  IF TG_OP='INSERT' THEN RAISE EXCEPTION 'Generate a draft before approval'; END IF;
  NEW.approved_by:=auth.uid();NEW.approved_at:=now();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a1_guard_pack_canonical BEFORE INSERT OR UPDATE ON public.evidence_packs FOR EACH ROW EXECUTE FUNCTION public.guard_pack_canonical();
-- Audit is a trigger in the same transaction, including direct REST writes.
CREATE FUNCTION public.audit_pack_transition() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE act text;
BEGIN
 IF TG_OP='INSERT' THEN act:='EVIDENCE_PACK_GENERATED';
 ELSIF NEW.status IS DISTINCT FROM OLD.status THEN act:='EVIDENCE_PACK_'||NEW.status;
 ELSE RETURN NEW; END IF;
 INSERT INTO public.audit_log(tenant_id,case_id,actor_user_id,action,entity_type,entity_id,payload)
 VALUES(NEW.tenant_id,NEW.case_id,auth.uid(),act,'evidence_pack',NEW.id,jsonb_build_object('version',NEW.version,'sha256_hash',NEW.sha256_hash,'status',NEW.status));
 IF act='EVIDENCE_PACK_APPROVED' THEN
  UPDATE public.cases SET status='APPROVED' WHERE id=NEW.case_id AND tenant_id=NEW.tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Case update unavailable; approval rolled back'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER atomic_pack_audit AFTER INSERT OR UPDATE ON public.evidence_packs FOR EACH ROW EXECUTE FUNCTION public.audit_pack_transition();
CREATE FUNCTION public.persist_evidence_pack_atomic(_case_id uuid,_canonical text) RETURNS public.evidence_packs LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE c public.cases;p jsonb;v integer;pack public.evidence_packs;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated investigator required'; END IF;
 SELECT * INTO c FROM public.cases WHERE id=_case_id;
 IF c.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND tenant_id=c.tenant_id AND role IN('admin','investigator')) THEN RAISE EXCEPTION 'Investigator access required'; END IF;
 IF octet_length(_canonical)>20000000 THEN RAISE EXCEPTION 'Evidence pack payload too large'; END IF;
 p:=_canonical::jsonb;
 PERFORM pg_advisory_xact_lock(hashtextextended('case-evidence:'||_case_id::text,0));
 SELECT coalesce(max(version),0)+1 INTO v FROM public.evidence_packs WHERE case_id=_case_id;
 IF (p->>'version')::integer IS DISTINCT FROM v THEN RAISE EXCEPTION 'Evidence pack version changed; reload and retry'; END IF;
 IF (p->>'generatedAt') IS NULL THEN RAISE EXCEPTION 'Pack generatedAt required'; END IF;
 PERFORM (p->>'generatedAt')::timestamptz;
 IF public.normalize_pack_source(p-'generatedAt'-'version') IS DISTINCT FROM public.normalize_pack_source(public.current_pack_source(_case_id)) THEN
  RAISE EXCEPTION 'Case evidence changed while preparing snapshot; reload and retry';
 END IF;
 -- Existing persistence trigger is the final role/clock/FLAGGED gate. No bypass.
 INSERT INTO public.evidence_packs(tenant_id,case_id,version,pack_payload,canonical_payload,sha256_hash,status)
 VALUES(c.tenant_id,_case_id,v,p,_canonical,encode(sha256(convert_to(_canonical,'UTF8')),'hex'),'DRAFT') RETURNING * INTO pack;
 UPDATE public.evidence_packs SET status='SUPERSEDED' WHERE case_id=_case_id AND id<>pack.id AND status='DRAFT';
 RETURN pack;
END $$;
CREATE FUNCTION public.approve_evidence_pack_atomic(_case_id uuid,_pack_id uuid) RETURNS public.evidence_packs LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE pack public.evidence_packs;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated investigator required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('case-evidence:'||_case_id::text,0));
 UPDATE public.evidence_packs SET status='APPROVED',approved_by=auth.uid() WHERE id=_pack_id AND case_id=_case_id AND status='DRAFT' RETURNING * INTO pack;
 IF pack.id IS NULL THEN RAISE EXCEPTION 'Draft evidence pack unavailable'; END IF;
 -- Role/clock/FLAGGED gate, actor stamping, case status and audit share this transaction.
 RETURN pack;
END $$;
REVOKE ALL ON FUNCTION public.lock_pack_source_case(),public.normalize_pack_source(jsonb),public.current_pack_source(uuid),public.guard_pack_canonical(),public.audit_pack_transition(),public.persist_evidence_pack_atomic(uuid,text),public.approve_evidence_pack_atomic(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.normalize_pack_source(jsonb),public.current_pack_source(uuid),public.persist_evidence_pack_atomic(uuid,text),public.approve_evidence_pack_atomic(uuid,uuid) TO authenticated;
COMMIT;
SELECT 'atomic_evidence_packs_v1_applied' AS result,
 to_regprocedure('public.persist_evidence_pack_atomic(uuid,text)') IS NOT NULL AS persistence_rpc,
 to_regprocedure('public.approve_evidence_pack_atomic(uuid,uuid)') IS NOT NULL AS approval_rpc,
 EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.evidence_packs'::regclass AND tgname='atomic_pack_audit' AND NOT tgisinternal) AS atomic_audit,
 EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.evidence_packs'::regclass AND tgname='operational_evidence_gate' AND NOT tgisinternal) AS original_gate_retained;
