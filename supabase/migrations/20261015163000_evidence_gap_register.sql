CREATE TABLE public.evidence_gap_entries(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),case_id uuid NOT NULL REFERENCES public.cases(id),
 physical_reference text NOT NULL CHECK(length(trim(physical_reference)) BETWEEN 3 AND 200),required_event text NOT NULL CHECK(length(trim(required_event)) BETWEEN 3 AND 200),
 requirement_basis text NOT NULL CHECK(length(trim(requirement_basis)) BETWEEN 10 AND 4000),status text NOT NULL CHECK(status IN ('EXPECTED','RECEIVED','CONFLICTING','MISSING')),
 explanation text NOT NULL CHECK(length(trim(explanation)) BETWEEN 10 AND 4000),document_ids uuid[] NOT NULL DEFAULT '{}',CHECK(cardinality(document_ids)<=20),
 evidence_reference text NOT NULL CHECK(length(trim(evidence_reference)) BETWEEN 3 AND 2000),supersedes_id uuid REFERENCES public.evidence_gap_entries(id),version integer NOT NULL CHECK(version>0),created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX evidence_gap_version ON public.evidence_gap_entries(case_id,physical_reference,required_event,version);
ALTER TABLE public.evidence_gap_entries ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON public.evidence_gap_entries TO authenticated;GRANT ALL ON public.evidence_gap_entries TO service_role;
CREATE POLICY "Tenant read gaps" ON public.evidence_gap_entries FOR SELECT TO authenticated USING(public.is_tenant_member(tenant_id));
CREATE POLICY "Investigators append gaps" ON public.evidence_gap_entries FOR INSERT TO authenticated WITH CHECK(EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND tenant_id=evidence_gap_entries.tenant_id AND role IN ('admin','investigator')));
CREATE OR REPLACE FUNCTION public.guard_evidence_gap() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE prev public.evidence_gap_entries;n integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Evidence gap history is append-only'; END IF;
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.cases WHERE id=NEW.case_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'Authenticated case member required'; END IF;
 SELECT count(*) INTO n FROM public.documents WHERE id=ANY(NEW.document_ids) AND case_id=NEW.case_id AND tenant_id=NEW.tenant_id;
 IF n<>cardinality(NEW.document_ids) THEN RAISE EXCEPTION 'Every distinct evidence source must belong to the case and tenant'; END IF;
 IF NEW.status='RECEIVED' AND n<1 THEN RAISE EXCEPTION 'Received requires source evidence'; END IF;
 IF NEW.status='CONFLICTING' AND n<2 THEN RAISE EXCEPTION 'Conflicting requires at least two source documents'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.case_id::text||':'||NEW.physical_reference||':'||NEW.required_event,0));
 SELECT * INTO prev FROM public.evidence_gap_entries WHERE case_id=NEW.case_id AND physical_reference=NEW.physical_reference AND required_event=NEW.required_event ORDER BY version DESC LIMIT 1;
 IF prev.id IS NULL THEN IF NEW.supersedes_id IS NOT NULL THEN RAISE EXCEPTION 'First gap record cannot supersede another'; END IF;NEW.version:=1;
 ELSE IF NEW.supersedes_id IS DISTINCT FROM prev.id THEN RAISE EXCEPTION 'Refresh and supersede latest gap state'; END IF;NEW.version:=prev.version+1;END IF;
 NEW.created_by:=auth.uid();NEW.created_at:=now();RETURN NEW;
END $$;
CREATE TRIGGER guard_evidence_gap BEFORE INSERT OR UPDATE OR DELETE ON public.evidence_gap_entries FOR EACH ROW EXECUTE FUNCTION public.guard_evidence_gap();
CREATE OR REPLACE FUNCTION public.audit_evidence_gap() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 INSERT INTO public.audit_log(tenant_id,case_id,actor_user_id,action,entity_type,entity_id,payload) VALUES(NEW.tenant_id,NEW.case_id,auth.uid(),'EVIDENCE_GAP_STATE_VERSIONED','evidence_gap_entry',NEW.id,to_jsonb(NEW));RETURN NEW;
END $$;
CREATE TRIGGER audit_evidence_gap AFTER INSERT ON public.evidence_gap_entries FOR EACH ROW EXECUTE FUNCTION public.audit_evidence_gap();
