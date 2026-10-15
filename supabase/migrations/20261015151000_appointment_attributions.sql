CREATE TABLE public.appointment_attributions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),case_id uuid NOT NULL REFERENCES public.cases(id),
 appointment_clock_id uuid NOT NULL REFERENCES public.operational_clocks(id),
 claimant text NOT NULL CHECK(length(trim(claimant)) BETWEEN 2 AND 200),claim_target text NOT NULL CHECK(length(trim(claim_target)) BETWEEN 2 AND 200),
 assertion text NOT NULL CHECK(length(trim(assertion)) BETWEEN 10 AND 4000),source_document_id uuid NOT NULL REFERENCES public.documents(id),
 source_reference text NOT NULL CHECK(length(trim(source_reference)) BETWEEN 3 AND 1000),terms_reference text NOT NULL CHECK(length(trim(terms_reference)) BETWEEN 3 AND 2000),
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.appointment_attributions ENABLE ROW LEVEL SECURITY;
CREATE INDEX ON public.appointment_attributions(tenant_id,case_id);
GRANT SELECT,INSERT ON public.appointment_attributions TO authenticated;
GRANT ALL ON public.appointment_attributions TO service_role;
CREATE POLICY "Tenant read attribution" ON public.appointment_attributions FOR SELECT TO authenticated USING(public.is_tenant_member(tenant_id));
CREATE POLICY "Investigators append attribution" ON public.appointment_attributions FOR INSERT TO authenticated WITH CHECK(EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND tenant_id=appointment_attributions.tenant_id AND role IN ('admin','investigator')));
CREATE OR REPLACE FUNCTION public.guard_appointment_attribution() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Attribution source records are append-only'; END IF;
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated investigator required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.operational_clocks c WHERE c.id=NEW.appointment_clock_id AND c.case_id=NEW.case_id AND c.tenant_id=NEW.tenant_id AND c.kind IN ('APPOINTMENT_START','APPOINTMENT_END')) THEN RAISE EXCEPTION 'Appointment must be a source clock in this case and tenant'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.documents d WHERE d.id=NEW.source_document_id AND d.case_id=NEW.case_id AND d.tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'Claim source must belong to case and tenant'; END IF;
 NEW.created_by:=auth.uid();NEW.created_at:=now();RETURN NEW;
END $$;
CREATE TRIGGER guard_appointment_attribution BEFORE INSERT OR UPDATE OR DELETE ON public.appointment_attributions FOR EACH ROW EXECUTE FUNCTION public.guard_appointment_attribution();
CREATE OR REPLACE FUNCTION public.audit_appointment_attribution() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 INSERT INTO public.audit_log(tenant_id,case_id,actor_user_id,action,entity_type,entity_id,payload) VALUES(NEW.tenant_id,NEW.case_id,auth.uid(),'APPOINTMENT_ATTRIBUTION_RECORDED','appointment_attribution',NEW.id,to_jsonb(NEW));RETURN NEW;
END $$;
CREATE TRIGGER audit_appointment_attribution AFTER INSERT ON public.appointment_attributions FOR EACH ROW EXECUTE FUNCTION public.audit_appointment_attribution();
