CREATE TABLE public.operational_clocks(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),case_id uuid NOT NULL REFERENCES public.cases(id),
 physical_reference text NOT NULL CHECK(length(trim(physical_reference)) BETWEEN 3 AND 200),
 kind text NOT NULL CHECK(kind IN ('QUEUE_ARRIVAL','APPOINTMENT_START','APPOINTMENT_END','GATE_IN','GATE_OUT')),
 timestamp_original text NOT NULL,occurred_at timestamptz NOT NULL,time_zone text NOT NULL,
 source_party text NOT NULL CHECK(length(trim(source_party)) BETWEEN 2 AND 200),source_document_id uuid NOT NULL REFERENCES public.documents(id),
 source_reference text NOT NULL CHECK(length(trim(source_reference)) BETWEEN 3 AND 1000),location_basis text NOT NULL CHECK(length(trim(location_basis)) BETWEEN 3 AND 1000),
 appointment_issuer text,appointment_reference text,appointment_parties text,appointment_terms text,
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(kind NOT LIKE 'APPOINTMENT_%' OR (length(trim(appointment_issuer))>0 AND length(trim(appointment_reference))>0 AND length(trim(appointment_parties))>0 AND length(trim(appointment_terms))>0))
);
CREATE INDEX ON public.operational_clocks(tenant_id,case_id,physical_reference);
ALTER TABLE public.operational_clocks ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON public.operational_clocks TO authenticated;
GRANT ALL ON public.operational_clocks TO service_role;
CREATE POLICY "Tenant read clocks" ON public.operational_clocks FOR SELECT TO authenticated USING(public.is_tenant_member(tenant_id));
CREATE POLICY "Investigators append clocks" ON public.operational_clocks FOR INSERT TO authenticated WITH CHECK(EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND tenant_id=operational_clocks.tenant_id AND role IN ('admin','investigator')));
CREATE OR REPLACE FUNCTION public.guard_operational_clock() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Clock source records are append-only'; END IF;
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated investigator required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cases WHERE id=NEW.case_id AND tenant_id=NEW.tenant_id) OR NOT EXISTS(SELECT 1 FROM public.documents WHERE id=NEW.source_document_id AND case_id=NEW.case_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'Clock evidence must belong to the case and tenant'; END IF;
 IF NEW.timestamp_original !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' OR NEW.timestamp_original::timestamptz IS DISTINCT FROM NEW.occurred_at THEN RAISE EXCEPTION 'Preserve the original timestamp with offset'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=NEW.time_zone) THEN RAISE EXCEPTION 'Valid IANA timezone required'; END IF;
 IF NEW.timestamp_original::timestamp IS DISTINCT FROM (NEW.occurred_at AT TIME ZONE NEW.time_zone) THEN RAISE EXCEPTION 'Timestamp offset does not match the stated source timezone at this instant'; END IF;
 IF NEW.kind LIKE 'APPOINTMENT_%' AND (coalesce(trim(NEW.appointment_issuer),'')='' OR coalesce(trim(NEW.appointment_reference),'')='' OR coalesce(trim(NEW.appointment_parties),'')='' OR coalesce(trim(NEW.appointment_terms),'')='') THEN RAISE EXCEPTION 'Appointment provenance required'; END IF;
 NEW.created_by:=auth.uid();NEW.created_at:=now();
 RETURN NEW;
END $$;
CREATE TRIGGER guard_operational_clock BEFORE INSERT OR UPDATE OR DELETE ON public.operational_clocks FOR EACH ROW EXECUTE FUNCTION public.guard_operational_clock();
CREATE OR REPLACE FUNCTION public.audit_operational_clock() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 INSERT INTO public.audit_log(tenant_id,case_id,actor_user_id,action,entity_type,entity_id,payload) VALUES(NEW.tenant_id,NEW.case_id,auth.uid(),'OPERATIONAL_CLOCK_RECORDED','operational_clock',NEW.id,to_jsonb(NEW));RETURN NEW;
END $$;
CREATE TRIGGER audit_operational_clock AFTER INSERT ON public.operational_clocks FOR EACH ROW EXECUTE FUNCTION public.audit_operational_clock();
