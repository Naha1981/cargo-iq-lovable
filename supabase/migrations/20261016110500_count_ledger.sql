-- Append-only count source and executable-rule registers. No seed/demo changes.
BEGIN;
SET LOCAL lock_timeout='10s';
CREATE TABLE public.count_source_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id),case_id uuid NOT NULL REFERENCES public.cases(id),
 physical_reference text NOT NULL CHECK(length(trim(physical_reference)) BETWEEN 3 AND 200),party text NOT NULL CHECK(length(trim(party)) BETWEEN 2 AND 200),
 metric text NOT NULL CHECK(metric IN ('HATCH_COVER','TRUCK_VISIT','CONTAINER_DELIVERY','GATE_COUNT')),
 basis text NOT NULL CHECK(basis IN ('HATCH_OPERATION','INDIVIDUAL_LIFT','TRUCK_VISIT','CONTAINER','TEU','GATE_EVENT')),
 quantity numeric NOT NULL CHECK(quantity>=0 AND quantity<=1000000000),occurred_at timestamptz NOT NULL,
 containers20 integer CHECK(containers20 BETWEEN 0 AND 10000),containers40 integer CHECK(containers40 BETWEEN 0 AND 10000),
 gate_kind text NOT NULL CHECK(gate_kind IN ('PHYSICAL_IN','PHYSICAL_OUT','VIRTUAL_IN','VIRTUAL_OUT','NOT_APPLICABLE')),
 source_document_id uuid NOT NULL REFERENCES public.documents(id),source_reference text NOT NULL CHECK(length(trim(source_reference)) BETWEEN 3 AND 1000),
 limitations text NOT NULL CHECK(length(trim(limitations)) BETWEEN 10 AND 4000),supersedes_id uuid REFERENCES public.count_source_records(id),version integer NOT NULL,
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((metric='HATCH_COVER' AND basis IN ('HATCH_OPERATION','INDIVIDUAL_LIFT')) OR (metric='TRUCK_VISIT' AND basis='TRUCK_VISIT') OR (metric='CONTAINER_DELIVERY' AND basis IN ('CONTAINER','TEU')) OR (metric='GATE_COUNT' AND basis='GATE_EVENT')),
 CHECK((metric='GATE_COUNT' AND gate_kind<>'NOT_APPLICABLE') OR (metric<>'GATE_COUNT' AND gate_kind='NOT_APPLICABLE'))
);
CREATE TABLE public.count_rule_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),case_id uuid NOT NULL REFERENCES public.cases(id),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 3 AND 200),metric text NOT NULL CHECK(metric IN ('HATCH_COVER','TRUCK_VISIT','CONTAINER_DELIVERY','GATE_COUNT')),
 input_basis text NOT NULL CHECK(input_basis IN ('HATCH_OPERATION','INDIVIDUAL_LIFT','TRUCK_VISIT','CONTAINER','TEU','GATE_EVENT')),output_unit text NOT NULL CHECK(length(trim(output_unit)) BETWEEN 1 AND 100),
 calculation text NOT NULL CHECK(calculation IN ('AS_REPORTED','PER_PHYSICAL_REFERENCE','CONTAINERS_FROM_MANIFEST','TEU_FROM_MANIFEST','EXPLICIT_FACTOR')),
 numerator integer NOT NULL CHECK(numerator BETWEEN 1 AND 1000000),denominator integer NOT NULL CHECK(denominator BETWEEN 1 AND 1000000),
 gate_kinds text[] NOT NULL DEFAULT '{}',acceptance text NOT NULL CHECK(acceptance IN ('AGREED','CONTRACTUALLY_SPECIFIED','PARTY_REPORTED','UNRESOLVED')),
 effective_from timestamptz NOT NULL,effective_to timestamptz CHECK(effective_to>effective_from),
 source_document_id uuid NOT NULL REFERENCES public.documents(id),source_reference text NOT NULL CHECK(length(trim(source_reference)) BETWEEN 3 AND 1000),
 rationale text NOT NULL CHECK(length(trim(rationale)) BETWEEN 10 AND 4000),supersedes_id uuid REFERENCES public.count_rule_versions(id),version integer NOT NULL,
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(gate_kinds <@ ARRAY['PHYSICAL_IN','PHYSICAL_OUT','VIRTUAL_IN','VIRTUAL_OUT']::text[]),
 CHECK(metric<>'GATE_COUNT' OR cardinality(gate_kinds)>0),
 CHECK(calculation='EXPLICIT_FACTOR' OR (numerator=1 AND denominator=1)),
 CHECK(calculation NOT IN ('CONTAINERS_FROM_MANIFEST','TEU_FROM_MANIFEST') OR metric IN ('TRUCK_VISIT','CONTAINER_DELIVERY'))
);
CREATE UNIQUE INDEX count_source_version ON public.count_source_records(case_id,party,physical_reference,metric,gate_kind,version);
CREATE UNIQUE INDEX count_rule_version ON public.count_rule_versions(case_id,name,version);
CREATE FUNCTION public.guard_count_register() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE prior jsonb; identity text; latest_id uuid; latest_version integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Count registers are append-only'; END IF;
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND tenant_id=NEW.tenant_id AND role IN ('admin','investigator')) THEN RAISE EXCEPTION 'Investigator access required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cases WHERE id=NEW.case_id AND tenant_id=NEW.tenant_id) OR NOT EXISTS(SELECT 1 FROM public.documents WHERE id=NEW.source_document_id AND case_id=NEW.case_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'Evidence must belong to case and tenant'; END IF;
 IF TG_TABLE_NAME='count_source_records' THEN
  IF NOT EXISTS(SELECT 1 FROM public.documents WHERE id=NEW.source_document_id AND lower(trim(source_party))=lower(trim(NEW.party))) THEN RAISE EXCEPTION 'Count party must match the source document organization'; END IF;
  identity:=NEW.party||':'||NEW.physical_reference||':'||NEW.metric||':'||NEW.gate_kind;
 ELSE identity:=NEW.name; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(TG_TABLE_NAME||':'||NEW.case_id::text||':'||identity,0));
 IF TG_TABLE_NAME='count_source_records' THEN
  SELECT id,version INTO latest_id,latest_version FROM public.count_source_records WHERE case_id=NEW.case_id AND party=NEW.party AND physical_reference=NEW.physical_reference AND metric=NEW.metric AND gate_kind=NEW.gate_kind ORDER BY version DESC LIMIT 1;
 ELSE SELECT id,version INTO latest_id,latest_version FROM public.count_rule_versions WHERE case_id=NEW.case_id AND name=NEW.name ORDER BY version DESC LIMIT 1;
 END IF;
 IF NEW.supersedes_id IS DISTINCT FROM latest_id THEN RAISE EXCEPTION 'Register changed; supersede latest version'; END IF;
 NEW.version:=coalesce(latest_version,0)+1;NEW.created_by:=auth.uid();NEW.created_at:=now();RETURN NEW;
END $$;
CREATE FUNCTION public.audit_count_register() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN INSERT INTO public.audit_log(tenant_id,case_id,actor_user_id,action,entity_type,entity_id,payload) VALUES(NEW.tenant_id,NEW.case_id,auth.uid(),'COUNT_REGISTER_APPENDED',TG_TABLE_NAME,NEW.id,to_jsonb(NEW));RETURN NEW;END $$;
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['count_source_records','count_rule_versions'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('GRANT SELECT,INSERT ON public.%I TO authenticated',t);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 EXECUTE format('CREATE POLICY tenant_read ON public.%I FOR SELECT TO authenticated USING(public.is_tenant_member(tenant_id))',t);
 EXECUTE format('CREATE POLICY investigator_append ON public.%I FOR INSERT TO authenticated WITH CHECK(EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND tenant_id=%I.tenant_id AND role IN (''admin'',''investigator'')))',t,t);
 EXECUTE format('CREATE TRIGGER a0_pack_source_case_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.lock_pack_source_case()',t);
 EXECUTE format('CREATE TRIGGER guard_count_register BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_count_register()',t);
 EXECUTE format('CREATE TRIGGER audit_count_register AFTER INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_count_register()',t);
END LOOP;END $$;
REVOKE ALL ON FUNCTION public.guard_count_register(),public.audit_count_register() FROM PUBLIC;
-- Snapshot extension is integrated separately, together with all new operational registers.
COMMIT;
