BEGIN;
SET LOCAL lock_timeout='10s';
CREATE TABLE public.appointment_lifecycle (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),case_id uuid NOT NULL REFERENCES public.cases(id),
 appointment_reference text NOT NULL CHECK(length(trim(appointment_reference)) BETWEEN 3 AND 200),physical_reference text NOT NULL CHECK(length(trim(physical_reference)) BETWEEN 3 AND 200),
 record_type text NOT NULL CHECK(record_type IN ('SLOT','ATTENDANCE','CANCELLATION','SYSTEM_FAILURE','RESPONSIBILITY_REVIEW')),
 issuer text NOT NULL CHECK(length(trim(issuer)) BETWEEN 2 AND 200),party text NOT NULL CHECK(length(trim(party)) BETWEEN 2 AND 200),
 start_at timestamptz,end_at timestamptz,occurred_at timestamptz NOT NULL,claim_target text NOT NULL CHECK(length(claim_target)<=200),
 outcome text NOT NULL CHECK(outcome IN ('NOT_ASSESSED','EVIDENCE_MISSING','CONTESTED','HUMAN_REVIEWED')),
 explanation text NOT NULL CHECK(length(trim(explanation)) BETWEEN 10 AND 4000),terms_reference text NOT NULL CHECK(length(trim(terms_reference)) BETWEEN 3 AND 2000),
 source_document_id uuid NOT NULL REFERENCES public.documents(id),source_reference text NOT NULL CHECK(length(trim(source_reference)) BETWEEN 3 AND 1000),
 supersedes_id uuid REFERENCES public.appointment_lifecycle(id),version integer NOT NULL,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((record_type='SLOT' AND start_at IS NOT NULL AND end_at IS NOT NULL AND end_at>start_at) OR (record_type<>'SLOT' AND start_at IS NULL AND end_at IS NULL)),
 CHECK(record_type<>'RESPONSIBILITY_REVIEW' OR (length(trim(claim_target))>0 AND outcome<>'NOT_ASSESSED'))
);
CREATE INDEX appointment_lifecycle_case ON public.appointment_lifecycle(case_id,appointment_reference,created_at);
CREATE FUNCTION public.guard_appointment_lifecycle() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE prev public.appointment_lifecycle; latest_id uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Appointment lifecycle is append-only'; END IF;
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND tenant_id=NEW.tenant_id AND role IN ('admin','investigator')) THEN RAISE EXCEPTION 'Investigator access required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cases WHERE id=NEW.case_id AND tenant_id=NEW.tenant_id) OR NOT EXISTS(SELECT 1 FROM public.documents WHERE id=NEW.source_document_id AND case_id=NEW.case_id AND tenant_id=NEW.tenant_id AND lower(trim(source_party))=lower(trim(NEW.party))) THEN RAISE EXCEPTION 'Evidence and source party must match case and tenant'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('appointment_lifecycle:'||NEW.case_id::text||':'||NEW.appointment_reference,0));
 IF NEW.supersedes_id IS NOT NULL THEN
  SELECT * INTO prev FROM public.appointment_lifecycle WHERE id=NEW.supersedes_id AND case_id=NEW.case_id AND tenant_id=NEW.tenant_id AND appointment_reference=NEW.appointment_reference AND record_type=NEW.record_type AND physical_reference=NEW.physical_reference AND party=NEW.party;
  IF prev.id IS NULL OR EXISTS(SELECT 1 FROM public.appointment_lifecycle WHERE supersedes_id=prev.id) THEN RAISE EXCEPTION 'Correction must supersede a current record of this appointment, party and type'; END IF;
  NEW.version:=prev.version+1;
 ELSE NEW.version:=1; END IF;
 NEW.created_by:=auth.uid();NEW.created_at:=now();RETURN NEW;
END $$;
CREATE FUNCTION public.audit_appointment_lifecycle() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN INSERT INTO public.audit_log(tenant_id,case_id,actor_user_id,action,entity_type,entity_id,payload) VALUES(NEW.tenant_id,NEW.case_id,auth.uid(),'APPOINTMENT_LIFECYCLE_APPENDED',TG_TABLE_NAME,NEW.id,to_jsonb(NEW));RETURN NEW;END $$;
ALTER TABLE public.appointment_lifecycle ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON public.appointment_lifecycle TO authenticated;GRANT ALL ON public.appointment_lifecycle TO service_role;
CREATE POLICY tenant_read ON public.appointment_lifecycle FOR SELECT TO authenticated USING(public.is_tenant_member(tenant_id));
CREATE POLICY investigator_append ON public.appointment_lifecycle FOR INSERT TO authenticated WITH CHECK(EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND tenant_id=appointment_lifecycle.tenant_id AND role IN ('admin','investigator')));
CREATE TRIGGER a0_pack_source_case_lock BEFORE INSERT OR UPDATE OR DELETE ON public.appointment_lifecycle FOR EACH ROW EXECUTE FUNCTION public.lock_pack_source_case();
CREATE TRIGGER guard_appointment_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON public.appointment_lifecycle FOR EACH ROW EXECUTE FUNCTION public.guard_appointment_lifecycle();
CREATE TRIGGER audit_appointment_lifecycle AFTER INSERT ON public.appointment_lifecycle FOR EACH ROW EXECUTE FUNCTION public.audit_appointment_lifecycle();
REVOKE ALL ON FUNCTION public.guard_appointment_lifecycle(),public.audit_appointment_lifecycle() FROM PUBLIC;
COMMIT;
