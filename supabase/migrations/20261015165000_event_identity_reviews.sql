CREATE TABLE public.cross_party_match_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),case_id uuid NOT NULL REFERENCES public.cases(id),match_id uuid NOT NULL REFERENCES public.cross_party_matches(id),
 status text NOT NULL CHECK(status IN ('IDENTITY_RETRACTED','IDENTITY_REAFFIRMED')),explanation text NOT NULL CHECK(length(trim(explanation)) BETWEEN 10 AND 4000),
 source_document_id uuid NOT NULL REFERENCES public.documents(id),source_reference text NOT NULL CHECK(length(trim(source_reference)) BETWEEN 3 AND 1000),version integer NOT NULL,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(match_id,version)
);
ALTER TABLE public.cross_party_match_reviews ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON public.cross_party_match_reviews TO authenticated;GRANT ALL ON public.cross_party_match_reviews TO service_role;
CREATE POLICY "Tenant read identity reviews" ON public.cross_party_match_reviews FOR SELECT TO authenticated USING(public.is_tenant_member(tenant_id));
CREATE POLICY "Investigators append identity reviews" ON public.cross_party_match_reviews FOR INSERT TO authenticated WITH CHECK(EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND tenant_id=cross_party_match_reviews.tenant_id AND role IN ('admin','investigator')));
CREATE OR REPLACE FUNCTION public.guard_match_identity_review() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF TG_OP<>'INSERT' OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated append-only identity review required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cross_party_matches WHERE id=NEW.match_id AND tenant_id=NEW.tenant_id AND case_id=NEW.case_id) OR NOT EXISTS(SELECT 1 FROM public.documents WHERE id=NEW.source_document_id AND tenant_id=NEW.tenant_id AND case_id=NEW.case_id) THEN RAISE EXCEPTION 'Review sources and match must belong to case and tenant'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('identity-review:'||NEW.match_id::text,0));
 SELECT coalesce(max(version),0)+1 INTO NEW.version FROM public.cross_party_match_reviews WHERE match_id=NEW.match_id;
 NEW.created_by:=auth.uid();NEW.created_at:=now();RETURN NEW;
END $$;
CREATE TRIGGER guard_match_identity_review BEFORE INSERT OR UPDATE OR DELETE ON public.cross_party_match_reviews FOR EACH ROW EXECUTE FUNCTION public.guard_match_identity_review();
CREATE OR REPLACE FUNCTION public.audit_match_identity_review() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 INSERT INTO public.audit_log(tenant_id,case_id,actor_user_id,action,entity_type,entity_id,payload) VALUES(NEW.tenant_id,NEW.case_id,auth.uid(),'EVENT_IDENTITY_REVIEWED','cross_party_match_review',NEW.id,to_jsonb(NEW));RETURN NEW;
END $$;
CREATE TRIGGER audit_match_identity_review AFTER INSERT ON public.cross_party_match_reviews FOR EACH ROW EXECUTE FUNCTION public.audit_match_identity_review();
-- Never silently resolve a contradiction when an identity is retracted.
-- The existing evidenced-resolution workflow must separately reconcile its flag.
