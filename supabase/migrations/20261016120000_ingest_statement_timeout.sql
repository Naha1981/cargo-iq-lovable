-- Fix: ingest_authorised_export exceeded the default statement timeout (~8s) on imports of
-- ~100 validated rows, cancelling with SQLSTATE 57014 and surfacing as an opaque UI error.
-- Raise the function-scoped statement timeout so the allowed 1-500 row atomic import fits,
-- preserving single-transaction atomicity (no client-side chunking of one logical export).
-- Idempotent: CREATE OR REPLACE keeps signature, grants are re-asserted below.
BEGIN;
CREATE OR REPLACE FUNCTION public.ingest_authorised_export(p_case_id uuid,p_source_document_id uuid,p_source_party text,p_dataset text,p_authorization_basis text,p_exported_at timestamptz,p_raw_csv text,p_rows jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET statement_timeout='120s' AS $$
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
COMMIT;
