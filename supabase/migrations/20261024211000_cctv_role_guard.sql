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
      -- Verify-or-abort idempotency: an existing policy must be our RESTRICTIVE
      -- admin/investigator guard structurally, never trusted by name alone.
      IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=policy_name) THEN
        IF NOT EXISTS(SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
                      WHERE n.nspname='public' AND c.relname=t AND p.polname=policy_name
                        AND NOT p.polpermissive
                        AND p.polroles = ARRAY[(SELECT oid FROM pg_roles WHERE rolname='authenticated')]::oid[]
                        AND position('user_roles' in coalesce(pg_get_expr(p.polqual,p.polrelid),'')||' '||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')) > 0
                        AND position('investigator' in coalesce(pg_get_expr(p.polqual,p.polrelid),'')||' '||coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')) > 0) THEN
          RAISE EXCEPTION 'CCTV policy % on % exists with an unexpected definition - inspect before continuing', policy_name, t;
        END IF;
      ELSE
        check_role:=format('EXISTS(SELECT 1 FROM public.user_roles r WHERE r.user_id=auth.uid() AND r.tenant_id=%I.tenant_id AND r.role IN (''admin'',''investigator''))',t);
        EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR %s TO authenticated %s',policy_name,t,cmd,
          CASE cmd WHEN 'INSERT' THEN 'WITH CHECK ('||check_role||')' WHEN 'DELETE' THEN 'USING ('||check_role||')' ELSE 'USING ('||check_role||') WITH CHECK ('||check_role||')' END);
      END IF;
    END LOOP;
  END LOOP;
END $guard$;
COMMIT;
SELECT 'cctv_role_guard_applied' AS result,
 (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'investigator_cctv_%')=15 AS cctv_write_guards;
