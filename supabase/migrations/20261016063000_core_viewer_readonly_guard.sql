-- Additive restrictive write policies. Preserve all existing SELECT policies and data.
-- Does not invite anyone, change roles or enable shared workspaces.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('cargoiq-core-viewer-readonly-v1',0));
DO $guard$
DECLARE t text;cmd text;policy_name text;check_role text;
BEGIN
 IF to_regclass('storage.objects') IS NULL THEN RAISE EXCEPTION 'Expected case-document storage missing; inspect before apply'; END IF;
 FOREACH t IN ARRAY ARRAY['cases','documents','extracted_claims','contradictions','timeline_events','external_observations','commercial_rules','financial_calculations','evidence_packs','audit_log'] LOOP
  IF to_regclass('public.'||t) IS NULL THEN RAISE EXCEPTION 'Core table % missing',t; END IF;
  FOREACH cmd IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
   policy_name:='investigator_core_'||lower(cmd);
   IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=policy_name) THEN RAISE EXCEPTION 'Guard already exists/partial deployment on %. Inspect before retry',t; END IF;
   check_role:=format('EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=auth.uid() AND r.tenant_id=%I.tenant_id AND r.role IN (''admin'',''investigator''))',t);
   EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR %s TO authenticated %s',policy_name,t,cmd,
    CASE cmd WHEN 'INSERT' THEN 'WITH CHECK ('||check_role||')' WHEN 'DELETE' THEN 'USING ('||check_role||')' ELSE 'USING ('||check_role||') WITH CHECK ('||check_role||')' END);
  END LOOP;
 END LOOP;
 FOREACH cmd IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
  policy_name:='investigator_case_documents_'||lower(cmd);
  IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname=policy_name) THEN RAISE EXCEPTION 'Storage guard already exists/partial deployment; inspect before retry'; END IF;
  check_role:='bucket_id <> ''case-documents'' OR EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=auth.uid() AND r.tenant_id::text=split_part(name,''/'',1) AND r.role IN (''admin'',''investigator''))';
  EXECUTE format('CREATE POLICY %I ON storage.objects AS RESTRICTIVE FOR %s TO authenticated %s',policy_name,cmd,
   CASE cmd WHEN 'INSERT' THEN 'WITH CHECK ('||check_role||')' WHEN 'DELETE' THEN 'USING ('||check_role||')' ELSE 'USING ('||check_role||') WITH CHECK ('||check_role||')' END);
 END LOOP;
END $guard$;
COMMIT;
SELECT 'core_viewer_readonly_guard_applied' AS result,
 (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname IN('investigator_core_insert','investigator_core_update','investigator_core_delete'))=30 AS core_write_guards,
 (SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname LIKE 'investigator_case_documents_%')=3 AS storage_write_guards;
