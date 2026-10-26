-- Owner-only daily AI/extraction health report (docs/AI-HEALTH-EMAIL.md).
-- Aggregate counts across all tenants, returned to platform admins only via
-- the same in-DB authorization as the other platform admin functions
-- (migration 20261024219000). Counts and statuses only: no claim text, no
-- document names, no tenant names, no user identifiers. No email is sent by
-- this change; the report feeds the in-app owner view (option C) and any
-- future granted sender.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('cargoiq-admin-ai-health-v1',0));

CREATE OR REPLACE FUNCTION public.admin_get_ai_health() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  -- Owner via JWT, or the server's own service role (the daily health-email
  -- cron invocation runs without a user JWT; docs/AI-HEALTH-EMAIL.md).
  IF NOT (
    public.is_platform_admin()
    OR coalesce(auth.jwt() ->> 'role', '') = 'service_role'
  ) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN jsonb_build_object(
    'generated_at', now(),
    'documents_24h', (
      SELECT coalesce(jsonb_object_agg(extraction_status, n), '{}'::jsonb)
      FROM (SELECT extraction_status, count(*)::integer AS n FROM public.documents
            WHERE uploaded_at >= now() - interval '24 hours' GROUP BY 1) s),
    'documents_7d', (
      SELECT coalesce(jsonb_object_agg(extraction_status, n), '{}'::jsonb)
      FROM (SELECT extraction_status, count(*)::integer AS n FROM public.documents
            WHERE uploaded_at >= now() - interval '7 days' GROUP BY 1) s),
    'app_errors_24h_total', (
      SELECT count(*)::integer FROM public.app_errors
      WHERE created_at >= now() - interval '24 hours'),
    'app_errors_24h_top_sources', (
      SELECT coalesce(jsonb_agg(jsonb_build_object('source', s.source, 'n', s.n) ORDER BY s.n DESC), '[]'::jsonb)
      FROM (SELECT coalesce(source, 'unspecified') AS source, count(*)::integer AS n
            FROM public.app_errors
            WHERE created_at >= now() - interval '24 hours'
            GROUP BY 1 ORDER BY n DESC LIMIT 5) s),
    'free_attempts_today', (
      SELECT coalesce(sum(attempts), 0)::integer FROM public.free_extraction_attempts
      WHERE day = (now() at time zone 'utc')::date),
    'latest_document_at', (SELECT max(uploaded_at) FROM public.documents),
    'latest_app_error_at', (SELECT max(created_at) FROM public.app_errors)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_ai_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_ai_health() TO authenticated;

COMMIT;
