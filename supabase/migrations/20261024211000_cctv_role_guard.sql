-- Close CCTV viewer bypass: tenant membership alone must not grant CCTV modify.
-- Mirrors the core viewer-readonly guard: additive RESTRICTIVE policies, no data changed.
-- Ingest runs on the service role (bypasses RLS), so device ingest is unaffected.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('cargoiq-cctv-role-guard-v1',0));
DO $guard$
DECLARE t text;cmd text;policy_name text;check_role text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cctv_sources','cctv_cameras','cctv_zones','cctv_observations','cctv_evidence_artifacts'] LOOP
    IF to_regclass('public.'||t) IS NULL THEN RAISE EXCEPTION 'CCTV table % missing',t; END IF;
    FOREACH cmd IN ARRAY ARRAY['INSERT','UPDATE','DELETE'] LOOP
      policy_name:='investigator_cctv_'||lower(cmd);
      IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=policy_name) THEN
        RAISE EXCEPTION 'CCTV guard already exists/partial deployment on %. Inspect before retry',t;
      END IF;
      check_role:=format('EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=auth.uid() AND r.tenant_id=%I.tenant_id AND r.role IN (''admin'',''investigator''))',t);
      EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR %s TO authenticated %s',policy_name,t,cmd,
        CASE cmd WHEN 'INSERT' THEN 'WITH CHECK ('||check_role||')' WHEN 'DELETE' THEN 'USING ('||check_role||')' ELSE 'USING ('||check_role||') WITH CHECK ('||check_role||')' END);
    END LOOP;
  END LOOP;
END $guard$;
COMMIT;
SELECT 'cctv_role_guard_applied' AS result,
 (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'investigator_cctv_%')=15 AS cctv_write_guards;
