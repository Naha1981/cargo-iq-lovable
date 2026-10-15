-- Vessel-specific operational clocks, not a universal 18-hour expectation.
ALTER TABLE public.operational_clocks DROP CONSTRAINT operational_clocks_kind_check;
ALTER TABLE public.operational_clocks ADD CONSTRAINT operational_clocks_kind_check CHECK(kind IN ('QUEUE_ARRIVAL','APPOINTMENT_START','APPOINTMENT_END','GATE_IN','GATE_OUT','VESSEL_WINDOW_START','FIRST_BOX_OFF','LAST_BOX_ON'));
CREATE TABLE public.kpi_definitions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),case_id uuid NOT NULL REFERENCES public.cases(id),
 party text NOT NULL CHECK(length(trim(party)) BETWEEN 2 AND 200),name text NOT NULL CHECK(length(trim(name)) BETWEEN 3 AND 200),physical_reference text NOT NULL CHECK(length(trim(physical_reference)) BETWEEN 3 AND 200),
 start_kind text NOT NULL,end_kind text NOT NULL,CHECK(start_kind<>end_kind),definition text NOT NULL CHECK(length(trim(definition)) BETWEEN 10 AND 4000),
 source_document_id uuid NOT NULL REFERENCES public.documents(id),source_reference text NOT NULL CHECK(length(trim(source_reference)) BETWEEN 3 AND 1000),
 acceptance text NOT NULL CHECK(acceptance IN ('CONTRACTUALLY_SPECIFIED','AGREED','PARTY_REPORTED','UNRESOLVED')),
 benchmark_hours numeric CHECK(benchmark_hours>=0 AND benchmark_hours<=100000),benchmark_basis text NOT NULL CHECK(length(trim(benchmark_basis)) BETWEEN 10 AND 4000),
 supersedes_id uuid REFERENCES public.kpi_definitions(id),version integer NOT NULL CHECK(version>0),created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX kpi_definition_version ON public.kpi_definitions(case_id,lower(trim(party)),lower(trim(name)),physical_reference,version);
ALTER TABLE public.kpi_definitions ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON public.kpi_definitions TO authenticated;GRANT ALL ON public.kpi_definitions TO service_role;
CREATE POLICY "Tenant read KPIs" ON public.kpi_definitions FOR SELECT TO authenticated USING(public.is_tenant_member(tenant_id));
CREATE POLICY "Investigators append KPIs" ON public.kpi_definitions FOR INSERT TO authenticated WITH CHECK(EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND tenant_id=kpi_definitions.tenant_id AND role IN ('admin','investigator')));
CREATE OR REPLACE FUNCTION public.guard_kpi_definition() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE prev public.kpi_definitions;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'KPI definitions are append-only'; END IF;
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated investigator required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.documents WHERE id=NEW.source_document_id AND case_id=NEW.case_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'KPI source must belong to case and tenant'; END IF;
 IF NEW.start_kind NOT IN ('QUEUE_ARRIVAL','APPOINTMENT_START','APPOINTMENT_END','GATE_IN','GATE_OUT','VESSEL_WINDOW_START','FIRST_BOX_OFF','LAST_BOX_ON') OR NEW.end_kind NOT IN ('QUEUE_ARRIVAL','APPOINTMENT_START','APPOINTMENT_END','GATE_IN','GATE_OUT','VESSEL_WINDOW_START','FIRST_BOX_OFF','LAST_BOX_ON') THEN RAISE EXCEPTION 'Unsupported KPI clock type'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.case_id::text||':'||lower(trim(NEW.party))||':'||lower(trim(NEW.name))||':'||NEW.physical_reference,0));
 SELECT * INTO prev FROM public.kpi_definitions WHERE case_id=NEW.case_id AND lower(trim(party))=lower(trim(NEW.party)) AND lower(trim(name))=lower(trim(NEW.name)) AND physical_reference=NEW.physical_reference ORDER BY version DESC LIMIT 1;
 IF prev.id IS NULL THEN IF NEW.supersedes_id IS NOT NULL THEN RAISE EXCEPTION 'First KPI version cannot supersede another'; END IF;NEW.version:=1;
 ELSE IF NEW.supersedes_id IS DISTINCT FROM prev.id THEN RAISE EXCEPTION 'Refresh and supersede the latest KPI version'; END IF;NEW.version:=prev.version+1;END IF;
 NEW.created_by:=auth.uid();NEW.created_at:=now();RETURN NEW;
END $$;
CREATE TRIGGER guard_kpi_definition BEFORE INSERT OR UPDATE OR DELETE ON public.kpi_definitions FOR EACH ROW EXECUTE FUNCTION public.guard_kpi_definition();
CREATE OR REPLACE FUNCTION public.audit_kpi_definition() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 INSERT INTO public.audit_log(tenant_id,case_id,actor_user_id,action,entity_type,entity_id,payload) VALUES(NEW.tenant_id,NEW.case_id,auth.uid(),'KPI_DEFINITION_VERSIONED','kpi_definition',NEW.id,to_jsonb(NEW));RETURN NEW;
END $$;
CREATE TRIGGER audit_kpi_definition AFTER INSERT ON public.kpi_definitions FOR EACH ROW EXECUTE FUNCTION public.audit_kpi_definition();
