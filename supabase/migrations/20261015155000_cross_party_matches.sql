CREATE TABLE public.cross_party_matches(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),case_id uuid NOT NULL REFERENCES public.cases(id),
 claim_a_id uuid NOT NULL REFERENCES public.extracted_claims(id),claim_b_id uuid NOT NULL REFERENCES public.extracted_claims(id),CHECK(claim_a_id<claim_b_id),
 event_reference text NOT NULL CHECK(length(trim(event_reference)) BETWEEN 3 AND 200),rationale text NOT NULL CHECK(length(trim(rationale)) BETWEEN 10 AND 4000),
 result text NOT NULL,contradiction_id uuid REFERENCES public.contradictions(id),created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(claim_a_id,claim_b_id)
);
ALTER TABLE public.cross_party_matches ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON public.cross_party_matches TO authenticated;GRANT ALL ON public.cross_party_matches TO service_role;
CREATE POLICY "Tenant read matches" ON public.cross_party_matches FOR SELECT TO authenticated USING(public.is_tenant_member(tenant_id));
CREATE POLICY "Investigators confirm matches" ON public.cross_party_matches FOR INSERT TO authenticated WITH CHECK(EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND tenant_id=cross_party_matches.tenant_id AND role IN ('admin','investigator')));
CREATE OR REPLACE FUNCTION public.guard_cross_party_match() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE a public.extracted_claims;b public.extracted_claims;party_a text;party_b text;existing_id uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Confirmed event matches are append-only'; END IF;
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated investigator required'; END IF;
 SELECT * INTO a FROM public.extracted_claims WHERE id=NEW.claim_a_id AND case_id=NEW.case_id AND tenant_id=NEW.tenant_id;
 SELECT * INTO b FROM public.extracted_claims WHERE id=NEW.claim_b_id AND case_id=NEW.case_id AND tenant_id=NEW.tenant_id;
 IF a.id IS NULL OR b.id IS NULL OR a.document_id IS NULL OR b.document_id IS NULL OR a.document_id=b.document_id THEN RAISE EXCEPTION 'Two distinct case source documents required'; END IF;
 SELECT source_party INTO party_a FROM public.documents WHERE id=a.document_id AND case_id=NEW.case_id AND tenant_id=NEW.tenant_id;
 SELECT source_party INTO party_b FROM public.documents WHERE id=b.document_id AND case_id=NEW.case_id AND tenant_id=NEW.tenant_id;
 IF coalesce(trim(party_a),'')='' OR coalesce(trim(party_b),'')='' OR lower(trim(party_a))=lower(trim(party_b)) THEN RAISE EXCEPTION 'Two distinct recorded source organizations required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.claim_a_id::text||NEW.claim_b_id::text,0));
 NEW.created_by:=auth.uid();NEW.created_at:=now();NEW.contradiction_id:=NULL;
 IF a.claim_type IS NULL OR a.claim_type<>b.claim_type OR a.claim_type='TEXT_RECORD' OR b.claim_type IS NULL THEN NEW.result:='HUMAN_REVIEW';
 ELSIF a.timestamp_claimed IS NULL OR b.timestamp_claimed IS NULL THEN NEW.result:='MISSING_TIME';
 ELSIF abs(extract(epoch FROM (a.timestamp_claimed-b.timestamp_claimed)))>=3600 THEN
  SELECT id INTO existing_id FROM public.contradictions WHERE case_id=NEW.case_id AND tenant_id=NEW.tenant_id AND ((claim_a_id=a.id AND claim_b_id=b.id) OR (claim_a_id=b.id AND claim_b_id=a.id)) ORDER BY created_at LIMIT 1;
  IF existing_id IS NULL THEN
   INSERT INTO public.contradictions(tenant_id,case_id,title,description,claim_a_id,claim_b_id,status,detected_by,citations)
    VALUES(NEW.tenant_id,NEW.case_id,'Cross-party timestamp conflict', 'Human-confirmed event '||NEW.event_reference||'. Same fact type, timestamps differ by at least one hour. '||NEW.rationale,a.id,b.id,'FLAGGED','CROSS_PARTY_RULE',jsonb_build_object('match_id',NEW.id,'party_a',party_a,'party_b',party_b)) RETURNING id INTO existing_id;
  END IF;
  NEW.result:='TIMESTAMP_CONFLICT';NEW.contradiction_id:=existing_id;
 ELSE NEW.result:='NO_THRESHOLD_CONFLICT';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_cross_party_match BEFORE INSERT OR UPDATE OR DELETE ON public.cross_party_matches FOR EACH ROW EXECUTE FUNCTION public.guard_cross_party_match();
CREATE OR REPLACE FUNCTION public.audit_cross_party_match() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 INSERT INTO public.audit_log(tenant_id,case_id,actor_user_id,action,entity_type,entity_id,payload) VALUES(NEW.tenant_id,NEW.case_id,auth.uid(),'CROSS_PARTY_EVENT_CONFIRMED','cross_party_match',NEW.id,to_jsonb(NEW));RETURN NEW;
END $$;
CREATE TRIGGER audit_cross_party_match AFTER INSERT ON public.cross_party_matches FOR EACH ROW EXECUTE FUNCTION public.audit_cross_party_match();
