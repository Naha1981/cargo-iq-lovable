BEGIN;
SET LOCAL lock_timeout='10s';
CREATE TABLE public.count_comparison_definitions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),case_id uuid NOT NULL REFERENCES public.cases(id),name text NOT NULL CHECK(length(trim(name)) BETWEEN 3 AND 200),
 metric text NOT NULL CHECK(metric IN ('HATCH_COVER','TRUCK_VISIT','CONTAINER_DELIVERY','GATE_COUNT')),output_unit text NOT NULL CHECK(length(trim(output_unit)) BETWEEN 1 AND 100),
 rule_ids uuid[] NOT NULL CHECK(cardinality(rule_ids) BETWEEN 1 AND 20),physical_references text[] NOT NULL CHECK(cardinality(physical_references) BETWEEN 1 AND 500),
 kpi_definition_id uuid REFERENCES public.kpi_definitions(id),acceptance text NOT NULL CHECK(acceptance IN ('UNRESOLVED','PARTY_REPORTED','AGREED','CONTRACTUALLY_SPECIFIED')),
 rationale text NOT NULL CHECK(length(trim(rationale)) BETWEEN 20 AND 4000),source_document_id uuid NOT NULL REFERENCES public.documents(id),source_reference text NOT NULL CHECK(length(trim(source_reference)) BETWEEN 3 AND 1000),
 supersedes_id uuid REFERENCES public.count_comparison_definitions(id),version integer NOT NULL,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(case_id,name,version)
);
CREATE FUNCTION public.guard_count_comparison() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE latest_id uuid;latest_version integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Comparison definitions are append-only';END IF;
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND tenant_id=NEW.tenant_id AND role IN ('admin','investigator')) THEN RAISE EXCEPTION 'Investigator access required';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cases WHERE id=NEW.case_id AND tenant_id=NEW.tenant_id) OR NOT EXISTS(SELECT 1 FROM public.documents WHERE id=NEW.source_document_id AND case_id=NEW.case_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'Source evidence must belong to case and tenant';END IF;
 IF EXISTS(SELECT 1 FROM unnest(NEW.rule_ids) r WHERE NOT EXISTS(SELECT 1 FROM public.count_rule_versions d WHERE d.id=r AND d.case_id=NEW.case_id AND d.tenant_id=NEW.tenant_id AND d.metric=NEW.metric AND d.output_unit=NEW.output_unit)) THEN RAISE EXCEPTION 'Every mapping must share case, tenant, metric and exact output unit';END IF;
 IF cardinality(NEW.rule_ids)<>(SELECT count(DISTINCT r) FROM unnest(NEW.rule_ids) r) OR cardinality(NEW.physical_references)<>(SELECT count(DISTINCT r) FROM unnest(NEW.physical_references) r) OR EXISTS(SELECT 1 FROM unnest(NEW.physical_references) r WHERE length(trim(r)) NOT BETWEEN 3 AND 200 OR r IS NULL) THEN RAISE EXCEPTION 'Explicit unique rules and physical references required';END IF;
 IF NEW.kpi_definition_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.kpi_definitions WHERE id=NEW.kpi_definition_id AND case_id=NEW.case_id AND tenant_id=NEW.tenant_id AND cardinality(NEW.physical_references)=1 AND physical_reference=NEW.physical_references[1]) THEN RAISE EXCEPTION 'Productivity clock must match the exact physical scope';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('count_comparison:'||NEW.case_id::text||':'||NEW.name,0));
 SELECT id,version INTO latest_id,latest_version FROM public.count_comparison_definitions WHERE case_id=NEW.case_id AND name=NEW.name ORDER BY version DESC LIMIT 1;
 IF NEW.supersedes_id IS DISTINCT FROM latest_id THEN RAISE EXCEPTION 'Comparison changed; supersede latest version';END IF;
 NEW.version:=coalesce(latest_version,0)+1;NEW.created_by:=auth.uid();NEW.created_at:=now();RETURN NEW;
END $$;
ALTER TABLE public.count_comparison_definitions ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON public.count_comparison_definitions TO authenticated;GRANT ALL ON public.count_comparison_definitions TO service_role;
CREATE POLICY tenant_read ON public.count_comparison_definitions FOR SELECT TO authenticated USING(public.is_tenant_member(tenant_id));
CREATE POLICY investigator_append ON public.count_comparison_definitions FOR INSERT TO authenticated WITH CHECK(EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND tenant_id=count_comparison_definitions.tenant_id AND role IN ('admin','investigator')));
CREATE TRIGGER a0_pack_source_case_lock BEFORE INSERT OR UPDATE OR DELETE ON public.count_comparison_definitions FOR EACH ROW EXECUTE FUNCTION public.lock_pack_source_case();
CREATE TRIGGER guard_count_comparison BEFORE INSERT OR UPDATE OR DELETE ON public.count_comparison_definitions FOR EACH ROW EXECUTE FUNCTION public.guard_count_comparison();
CREATE TRIGGER audit_count_comparison AFTER INSERT ON public.count_comparison_definitions FOR EACH ROW EXECUTE FUNCTION public.audit_count_register();
REVOKE ALL ON FUNCTION public.guard_count_comparison() FROM PUBLIC;
COMMIT;
