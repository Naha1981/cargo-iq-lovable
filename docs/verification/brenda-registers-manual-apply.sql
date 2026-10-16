-- CargoIQ Brenda operational registers. Apply once in the correct CargoIQ Cloud SQL editor.
-- Existing core, nine-pain, atomic-pack and viewer guards are prerequisites.
-- Additive only: no seed changes, real invitations, paid providers or AI flags.
-- Entire bundle is one transaction. On error nothing in this bundle should commit.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='90s';
DO $$ BEGIN
 IF to_regprocedure('public.persist_evidence_pack_atomic(uuid,text)') IS NULL THEN RAISE EXCEPTION 'Existing atomic-pack migration required';END IF;
 IF to_regclass('public.count_source_records') IS NOT NULL OR to_regclass('public.appointment_lifecycle') IS NOT NULL OR to_regclass('public.authorised_imports') IS NOT NULL OR to_regclass('public.count_comparison_definitions') IS NOT NULL THEN RAISE EXCEPTION 'New registers already exist or partial install. Inspect before retry';END IF;
END $$;

-- 20261016110500_count_ledger.sql
-- Append-only count source and executable-rule registers. No seed/demo changes.
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
 CHECK((metric='GATE_COUNT' AND cardinality(gate_kinds)>0) OR (metric<>'GATE_COUNT' AND cardinality(gate_kinds)=0)),
 CHECK((metric='HATCH_COVER' AND input_basis IN ('HATCH_OPERATION','INDIVIDUAL_LIFT')) OR (metric='TRUCK_VISIT' AND input_basis='TRUCK_VISIT') OR (metric='CONTAINER_DELIVERY' AND input_basis IN ('CONTAINER','TEU')) OR (metric='GATE_COUNT' AND input_basis='GATE_EVENT')),
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
 ELSE IF cardinality(NEW.gate_kinds)<>(SELECT count(DISTINCT k) FROM unnest(NEW.gate_kinds) k) THEN RAISE EXCEPTION 'Duplicate gate filters'; END IF; identity:=NEW.name; END IF;
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

-- 20261016111000_appointment_lifecycle.sql
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

-- 20261016111500_authorised_exports.sql
SET LOCAL lock_timeout='10s';
CREATE TABLE public.authorised_imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),case_id uuid NOT NULL REFERENCES public.cases(id),source_document_id uuid NOT NULL REFERENCES public.documents(id),
 source_party text NOT NULL CHECK(length(trim(source_party)) BETWEEN 2 AND 200),dataset text NOT NULL CHECK(dataset IN ('COUNTS','APPOINTMENTS')),
 authorization_basis text NOT NULL CHECK(length(trim(authorization_basis)) BETWEEN 20 AND 4000),exported_at timestamptz NOT NULL,
 raw_csv text NOT NULL CHECK(length(raw_csv) BETWEEN 20 AND 300000),raw_sha256 text NOT NULL,row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 500),
 created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(case_id,dataset,raw_sha256)
);
ALTER TABLE public.count_source_records ADD COLUMN import_id uuid REFERENCES public.authorised_imports(id);
ALTER TABLE public.appointment_lifecycle ADD COLUMN import_id uuid REFERENCES public.authorised_imports(id);
ALTER TABLE public.authorised_imports ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.authorised_imports TO authenticated;GRANT ALL ON public.authorised_imports TO service_role;
CREATE POLICY tenant_read ON public.authorised_imports FOR SELECT TO authenticated USING(public.is_tenant_member(tenant_id));
CREATE FUNCTION public.guard_import_link() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NEW.import_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.authorised_imports i WHERE i.id=NEW.import_id AND i.tenant_id=NEW.tenant_id AND i.case_id=NEW.case_id AND i.source_document_id=NEW.source_document_id AND i.source_party=NEW.party AND i.dataset=CASE TG_TABLE_NAME WHEN 'count_source_records' THEN 'COUNTS' ELSE 'APPOINTMENTS' END) THEN RAISE EXCEPTION 'Import link does not match this source row';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_import_link BEFORE INSERT ON public.count_source_records FOR EACH ROW EXECUTE FUNCTION public.guard_import_link();
CREATE TRIGGER guard_import_link BEFORE INSERT ON public.appointment_lifecycle FOR EACH ROW EXECUTE FUNCTION public.guard_import_link();
REVOKE ALL ON FUNCTION public.guard_import_link() FROM PUBLIC;
CREATE FUNCTION public.reject_import_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Import provenance is immutable';END $$;
CREATE TRIGGER reject_import_mutation BEFORE UPDATE OR DELETE ON public.authorised_imports FOR EACH ROW EXECUTE FUNCTION public.reject_import_mutation();
CREATE TRIGGER a0_pack_source_case_lock BEFORE INSERT OR UPDATE OR DELETE ON public.authorised_imports FOR EACH ROW EXECUTE FUNCTION public.lock_pack_source_case();
-- Parse and bind the raw export to its typed row mapping inside the same transaction.
CREATE FUNCTION public.parse_export_csv(p_text text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE result jsonb:='[]';row_value jsonb:='[]';cell text:='';ch text;quoted boolean:=false;closed boolean:=false;i integer:=1;n integer;
BEGIN
 n:=length(p_text);IF n>300000 THEN RAISE EXCEPTION 'CSV exceeds size limit';END IF;
 IF left(p_text,1)=chr(65279) THEN p_text:=substr(p_text,2);n:=length(p_text);END IF;
 WHILE i<=n LOOP
  ch:=substr(p_text,i,1);
  IF quoted THEN
   IF ch='"' THEN IF substr(p_text,i+1,1)='"' THEN cell:=cell||'"';i:=i+1;ELSE quoted:=false;closed:=true;END IF;ELSE cell:=cell||ch;END IF;
  ELSIF ch='"' THEN IF cell<>'' OR closed THEN RAISE EXCEPTION 'Malformed CSV quote';END IF;quoted:=true;
  ELSIF ch=',' THEN row_value:=row_value||jsonb_build_array(cell);cell:='';closed:=false;
  ELSIF ch=chr(10) OR ch=chr(13) THEN
   IF ch=chr(13) AND substr(p_text,i+1,1)=chr(10) THEN i:=i+1;END IF;
   row_value:=row_value||jsonb_build_array(cell);
   IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(row_value) AS v WHERE v<>'') THEN result:=result||jsonb_build_array(row_value);END IF;
   row_value:='[]';cell:='';closed:=false;
  ELSE IF closed THEN RAISE EXCEPTION 'Content after quoted field';END IF;cell:=cell||ch;END IF;
  IF jsonb_array_length(result)>501 THEN RAISE EXCEPTION 'Maximum 500 rows';END IF;i:=i+1;
 END LOOP;
 IF quoted THEN RAISE EXCEPTION 'Unclosed CSV quote';END IF;
 row_value:=row_value||jsonb_build_array(cell);IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(row_value) AS v WHERE v<>'') THEN result:=result||jsonb_build_array(row_value);END IF;
 RETURN result;
END $$;
CREATE FUNCTION public.ingest_authorised_export(p_case_id uuid,p_source_document_id uuid,p_source_party text,p_dataset text,p_authorization_basis text,p_exported_at timestamptz,p_raw_csv text,p_rows jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_tenant uuid; v_id uuid;v_hash text;r jsonb;v_count integer;v_csv jsonb;v_headers jsonb;v_expected jsonb;v_cells jsonb;v_row jsonb;v_i integer:=0;v_j integer;v_key text;
BEGIN
 SELECT c.tenant_id INTO v_tenant FROM public.cases c JOIN public.user_roles ur ON ur.tenant_id=c.tenant_id AND ur.user_id=auth.uid() AND ur.role IN ('admin','investigator') WHERE c.id=p_case_id;
 IF v_tenant IS NULL THEN RAISE EXCEPTION 'Investigator access required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.documents WHERE id=p_source_document_id AND case_id=p_case_id AND tenant_id=v_tenant AND lower(trim(source_party))=lower(trim(p_source_party))) THEN RAISE EXCEPTION 'Source document and organization must match this case';END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Rows must be an array';END IF;
 v_csv:=public.parse_export_csv(p_raw_csv);
 v_headers:=CASE p_dataset WHEN 'COUNTS' THEN '["physicalReference","metric","basis","quantity","occurredAt","containers20","containers40","gateKind","sourceReference","limitations"]'::jsonb WHEN 'APPOINTMENTS' THEN '["appointmentReference","physicalReference","recordType","issuer","startAt","endAt","occurredAt","claimTarget","outcome","explanation","termsReference","sourceReference"]'::jsonb ELSE NULL END;
 IF v_headers IS NULL OR v_csv->0 IS DISTINCT FROM v_headers OR jsonb_array_length(v_csv)<>jsonb_array_length(p_rows)+1 THEN RAISE EXCEPTION 'CSV schema or row count differs from mapping';END IF;
 v_count:=jsonb_array_length(p_rows);IF v_count<1 OR v_count>500 THEN RAISE EXCEPTION 'Export requires 1 to 500 validated source rows';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('case-evidence:'||p_case_id::text,0));
 v_hash:=encode(sha256(convert_to(p_raw_csv,'UTF8')),'hex');
 INSERT INTO public.authorised_imports(tenant_id,case_id,source_document_id,source_party,dataset,authorization_basis,exported_at,raw_csv,raw_sha256,row_count,created_by) VALUES(v_tenant,p_case_id,p_source_document_id,p_source_party,p_dataset,p_authorization_basis,p_exported_at,p_raw_csv,v_hash,v_count,auth.uid()) RETURNING id INTO v_id;
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  v_i:=v_i+1;v_cells:=v_csv->v_i;
  IF jsonb_array_length(v_cells)<>jsonb_array_length(v_headers) THEN RAISE EXCEPTION 'CSV column count differs';END IF;
  v_expected:=jsonb_build_object('caseId',p_case_id,'sourceDocumentId',p_source_document_id,'party',trim(p_source_party),'supersedesId',NULL);
  FOR v_j IN 0..jsonb_array_length(v_headers)-1 LOOP
   v_key:=v_headers->>v_j;
   v_row:=to_jsonb(v_cells->>v_j);
   IF v_key IN ('quantity','containers20','containers40') THEN
    IF v_key<>'quantity' AND v_cells->>v_j='' THEN v_row:='null'::jsonb;ELSE v_row:=to_jsonb((v_cells->>v_j)::numeric);END IF;
   ELSIF v_key IN ('startAt','endAt') AND v_cells->>v_j='' THEN v_row:='null'::jsonb;
   ELSE v_row:=to_jsonb(trim(v_cells->>v_j));END IF;
   IF v_key IN ('startAt','endAt','occurredAt') AND v_row<>'null'::jsonb AND (v_cells->>v_j) !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RAISE EXCEPTION 'Timestamp requires explicit offset';END IF;
   v_expected:=v_expected||jsonb_build_object(v_key,v_row);
  END LOOP;
  IF r IS DISTINCT FROM v_expected THEN RAISE EXCEPTION 'Typed row differs from immutable raw CSV';END IF;
  IF r->>'caseId' IS DISTINCT FROM p_case_id::text OR r->>'sourceDocumentId' IS DISTINCT FROM p_source_document_id::text OR r->>'party' IS DISTINCT FROM p_source_party OR r->>'supersedesId' IS NOT NULL THEN RAISE EXCEPTION 'Import rows cannot change source, case, party or existing versions';END IF;
  IF p_dataset='COUNTS' THEN
   INSERT INTO public.count_source_records(tenant_id,case_id,physical_reference,party,metric,basis,quantity,occurred_at,containers20,containers40,gate_kind,source_document_id,source_reference,limitations,supersedes_id,import_id) VALUES(v_tenant,p_case_id,r->>'physicalReference',p_source_party,r->>'metric',r->>'basis',(r->>'quantity')::numeric,(r->>'occurredAt')::timestamptz,(r->>'containers20')::integer,(r->>'containers40')::integer,r->>'gateKind',p_source_document_id,r->>'sourceReference',r->>'limitations',NULL,v_id);
  ELSIF p_dataset='APPOINTMENTS' THEN
   INSERT INTO public.appointment_lifecycle(tenant_id,case_id,appointment_reference,physical_reference,record_type,issuer,party,start_at,end_at,occurred_at,claim_target,outcome,explanation,terms_reference,source_document_id,source_reference,supersedes_id,import_id) VALUES(v_tenant,p_case_id,r->>'appointmentReference',r->>'physicalReference',r->>'recordType',r->>'issuer',p_source_party,(r->>'startAt')::timestamptz,(r->>'endAt')::timestamptz,(r->>'occurredAt')::timestamptz,r->>'claimTarget',r->>'outcome',r->>'explanation',r->>'termsReference',p_source_document_id,r->>'sourceReference',NULL,v_id);
  ELSE RAISE EXCEPTION 'Unsupported dataset';END IF;
 END LOOP;
 INSERT INTO public.audit_log(tenant_id,case_id,actor_user_id,action,entity_type,entity_id,payload) VALUES(v_tenant,p_case_id,auth.uid(),'AUTHORISED_EXPORT_IMPORTED','authorised_imports',v_id,jsonb_build_object('dataset',p_dataset,'row_count',v_count,'sha256',v_hash,'source_document_id',p_source_document_id,'authorization_basis',p_authorization_basis));
 RETURN jsonb_build_object('id',v_id,'row_count',v_count,'raw_sha256',v_hash);
END $$;
REVOKE ALL ON FUNCTION public.ingest_authorised_export(uuid,uuid,text,text,text,timestamptz,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingest_authorised_export(uuid,uuid,text,text,text,timestamptz,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.parse_export_csv(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_import_mutation() FROM PUBLIC;

-- 20261016112000_count_comparisons.sql
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

-- 20261016112500_extended_pack_sources.sql
-- Extend the existing atomic source comparison, never bypass it. Historical packs stay immutable.
SET LOCAL lock_timeout='10s';
CREATE OR REPLACE FUNCTION public.current_pack_source(_case_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT jsonb_build_object(
  'case',(SELECT to_jsonb(c) FROM public.cases c WHERE id=_case_id),
  'documents',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.documents r WHERE case_id=_case_id),'[]'::jsonb),
  'operationalDefinitions',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.operational_definitions r WHERE case_id=_case_id),'[]'::jsonb),
  'operationalClocks',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.operational_clocks r WHERE case_id=_case_id),'[]'::jsonb),
  'appointmentAttributions',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.appointment_attributions r WHERE case_id=_case_id),'[]'::jsonb),
  'kpiDefinitions',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.kpi_definitions r WHERE case_id=_case_id),'[]'::jsonb),
  'crossPartyMatches',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.cross_party_matches r WHERE case_id=_case_id),'[]'::jsonb),
  'evidenceGapHistory',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.evidence_gap_entries r WHERE case_id=_case_id),'[]'::jsonb),
  'eventIdentityReviews',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.cross_party_match_reviews r WHERE case_id=_case_id),'[]'::jsonb),
  'clockReconciliations',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.clock_reconciliations r WHERE case_id=_case_id),'[]'::jsonb),
  'claims',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.extracted_claims r WHERE case_id=_case_id),'[]'::jsonb),
  'contradictions',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.contradictions r WHERE case_id=_case_id),'[]'::jsonb),
  'timeline',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.timeline_events r WHERE case_id=_case_id),'[]'::jsonb),
  'externalObservations',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.external_observations r WHERE case_id=_case_id),'[]'::jsonb),
  'financialCalculations',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.financial_calculations r WHERE case_id=_case_id),'[]'::jsonb),
  'verifiedClaims',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.extracted_claims r WHERE case_id=_case_id AND status='VERIFIED'),'[]'::jsonb),
  'countSourceRecords',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.count_source_records r WHERE case_id=_case_id),'[]'::jsonb),
  'countRuleVersions',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.count_rule_versions r WHERE case_id=_case_id),'[]'::jsonb),
  'countComparisons',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.count_comparison_definitions r WHERE case_id=_case_id),'[]'::jsonb),
  'appointmentLifecycle',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.appointment_lifecycle r WHERE case_id=_case_id),'[]'::jsonb),
  'authorisedImports',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.authorised_imports r WHERE case_id=_case_id),'[]'::jsonb),
  'countEngineVersion','1',
  'approvals','[]'::jsonb,
  'truthRule','Public and independent observations are corroboration unless the source directly proves the event. Inference remains inference until human review.'
 )
$$;
COMMIT;
SELECT 'brenda_operational_registers_applied' AS result,
 to_regclass('public.count_source_records') IS NOT NULL AS count_ledger,
 to_regclass('public.appointment_lifecycle') IS NOT NULL AS appointment_lifecycle,
 to_regclass('public.authorised_imports') IS NOT NULL AS authorised_imports,
 to_regclass('public.count_comparison_definitions') IS NOT NULL AS count_comparisons;
