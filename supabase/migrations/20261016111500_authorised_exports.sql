BEGIN;
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
 PERFORM pg_advisory_xact_lock(hashtextextended('cargoiq-pack-source:'||p_case_id::text,0));
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
COMMIT;
