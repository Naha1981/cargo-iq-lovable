CREATE TABLE public.operational_definitions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 case_id uuid NOT NULL REFERENCES public.cases(id),party text NOT NULL CHECK(length(trim(party)) BETWEEN 2 AND 200),
 metric text NOT NULL CHECK(metric IN ('HATCH_COVER','TRUCK_VISIT','CONTAINER_DELIVERY','GATE_COUNT','OTHER')),
 unit text NOT NULL CHECK(length(trim(unit)) BETWEEN 1 AND 100),rule text NOT NULL CHECK(length(trim(rule)) BETWEEN 10 AND 4000),
 original_source_text text NOT NULL CHECK(length(trim(original_source_text)) BETWEEN 10 AND 8000),
 source_document_id uuid NOT NULL REFERENCES public.documents(id),source_reference text NOT NULL CHECK(length(trim(source_reference)) BETWEEN 3 AND 1000),
 effective_from timestamptz NOT NULL,effective_to timestamptz,CHECK(effective_to IS NULL OR effective_to>effective_from),
 acceptance text NOT NULL CHECK(acceptance IN ('CONTRACTUALLY_SPECIFIED','AGREED','PARTY_REPORTED','UNRESOLVED')),
 acceptance_basis text NOT NULL CHECK(length(trim(acceptance_basis)) BETWEEN 10 AND 2000),
 supersedes_id uuid REFERENCES public.operational_definitions(id),version integer NOT NULL CHECK(version>0),
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX operational_definition_version ON public.operational_definitions(case_id,lower(trim(party)),metric,version);
CREATE INDEX ON public.operational_definitions(tenant_id,case_id);
ALTER TABLE public.operational_definitions ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON public.operational_definitions TO authenticated;
GRANT ALL ON public.operational_definitions TO service_role;
CREATE POLICY "Tenant read definitions" ON public.operational_definitions FOR SELECT TO authenticated USING(public.is_tenant_member(tenant_id));
CREATE POLICY "Investigators append definitions" ON public.operational_definitions FOR INSERT TO authenticated WITH CHECK(
 EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND tenant_id=operational_definitions.tenant_id AND role IN ('admin','investigator')));
CREATE OR REPLACE FUNCTION public.guard_operational_definition() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE last_row public.operational_definitions;
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Definitions are append-only; create a new version'; END IF;
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated investigator required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cases c WHERE c.id=NEW.case_id AND c.tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'Case tenant mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.documents d WHERE d.id=NEW.source_document_id AND d.case_id=NEW.case_id AND d.tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'Source document must belong to case and tenant'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.case_id::text||':'||lower(trim(NEW.party))||':'||NEW.metric,0));
 SELECT * INTO last_row FROM public.operational_definitions WHERE case_id=NEW.case_id AND lower(trim(party))=lower(trim(NEW.party)) AND metric=NEW.metric ORDER BY version DESC LIMIT 1;
 IF last_row.id IS NULL THEN
  IF NEW.supersedes_id IS NOT NULL THEN RAISE EXCEPTION 'First version cannot supersede a record'; END IF;
  NEW.version:=1;
 ELSE
  IF NEW.supersedes_id IS DISTINCT FROM last_row.id THEN RAISE EXCEPTION 'Definition changed; load and supersede the latest version'; END IF;
  NEW.version:=last_row.version+1;
 END IF;
 NEW.created_by:=auth.uid();NEW.created_at:=now();
 RETURN NEW;
END $$;
CREATE TRIGGER guard_operational_definition BEFORE INSERT OR UPDATE OR DELETE ON public.operational_definitions FOR EACH ROW EXECUTE FUNCTION public.guard_operational_definition();
CREATE OR REPLACE FUNCTION public.audit_operational_definition() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 INSERT INTO public.audit_log(tenant_id,case_id,actor_user_id,action,entity_type,entity_id,payload)
 VALUES(NEW.tenant_id,NEW.case_id,auth.uid(),'OPERATIONAL_DEFINITION_VERSIONED','operational_definition',NEW.id,to_jsonb(NEW));
 RETURN NEW;
END $$;
CREATE TRIGGER audit_operational_definition AFTER INSERT ON public.operational_definitions FOR EACH ROW EXECUTE FUNCTION public.audit_operational_definition();
