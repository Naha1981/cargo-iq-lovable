-- Owner-only platform administration (user request 25 Oct: "super admin panel for me
-- alone"). The allowlist lives in platform_admins and is readable ONLY through the
-- SECURITY DEFINER functions below (RLS enabled, no direct policies = no direct access).
-- Identity comes from the caller's immutable auth user id (the owning source); no client
-- flags, no role grants, no email assumptions. The migration intentionally seeds NO row:
-- the first owner row is inserted by hand at apply time with the user's VERIFIED auth
-- user id, same approval path as the other Block 3 SQL.
-- Every list function is keyset-paged with a true total: a bounded page is never
-- presented as "all", and following next_cursor reaches every row.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('cargoiq-platform-admin-v1',0));

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id uuid PRIMARY KEY,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: direct table access is denied to every non-superuser role.
-- Revocation is deleting the row; every function re-checks membership on every call.

CREATE OR REPLACE FUNCTION public.is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_tenants(p_limit integer DEFAULT 100, p_cursor timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN (
    WITH page AS (
      SELECT t.*, row_number() OVER (ORDER BY t.created_at DESC, t.id DESC) AS rn
      FROM public.tenants t
      WHERE p_cursor IS NULL OR t.created_at < p_cursor
      ORDER BY t.created_at DESC, t.id DESC LIMIT v_limit + 1)
    SELECT jsonb_build_object(
      'rows', coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'created_at', p.created_at,
        'users', (SELECT count(*) FROM public.user_roles r WHERE r.tenant_id = p.id),
        'cases', (SELECT count(*) FROM public.cases c WHERE c.tenant_id = p.id)
      ) ORDER BY p.rn) FILTER (WHERE p.rn <= v_limit), '[]'::jsonb),
      'total', (SELECT count(*) FROM public.tenants),
      'next_cursor', CASE WHEN count(*) > v_limit THEN max(p.created_at) FILTER (WHERE p.rn = v_limit) END
    ) FROM page p);
END $$;

CREATE OR REPLACE FUNCTION public.admin_list_users(p_limit integer DEFAULT 100, p_cursor timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public, auth AS $$
DECLARE v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN (
    WITH page AS (
      SELECT r.tenant_id, r.user_id, r.role, r.created_at,
             row_number() OVER (ORDER BY r.created_at DESC, r.user_id DESC) AS rn
      FROM public.user_roles r
      WHERE p_cursor IS NULL OR r.created_at < p_cursor
      ORDER BY r.created_at DESC, r.user_id DESC LIMIT v_limit + 1)
    SELECT jsonb_build_object(
      'rows', coalesce(jsonb_agg(jsonb_build_object(
        'tenant_id', p.tenant_id, 'user_id', p.user_id, 'role', p.role,
        'display', coalesce(nullif(u.raw_user_meta_data->>'full_name',''), u.email, 'unknown user'),
        'email', u.email
      ) ORDER BY p.rn) FILTER (WHERE p.rn <= v_limit), '[]'::jsonb),
      'total', (SELECT count(*) FROM public.user_roles),
      'next_cursor', CASE WHEN count(*) > v_limit THEN max(p.created_at) FILTER (WHERE p.rn = v_limit) END
    ) FROM page p LEFT JOIN auth.users u ON u.id = p.user_id);
END $$;

CREATE OR REPLACE FUNCTION public.admin_list_cases(p_limit integer DEFAULT 100, p_cursor timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN (
    WITH page AS (
      SELECT c.*, row_number() OVER (ORDER BY c.created_at DESC, c.id DESC) AS rn
      FROM public.cases c
      WHERE p_cursor IS NULL OR c.created_at < p_cursor
      ORDER BY c.created_at DESC, c.id DESC LIMIT v_limit + 1)
    SELECT jsonb_build_object(
      'rows', coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'tenant_id', p.tenant_id, 'title', p.title, 'created_at', p.created_at,
        'open_disputes', (SELECT count(*) FROM public.contradictions x WHERE x.case_id = p.id AND x.status = 'FLAGGED')
      ) ORDER BY p.rn) FILTER (WHERE p.rn <= v_limit), '[]'::jsonb),
      'total', (SELECT count(*) FROM public.cases),
      'next_cursor', CASE WHEN count(*) > v_limit THEN max(p.created_at) FILTER (WHERE p.rn = v_limit) END
    ) FROM page p);
END $$;

CREATE OR REPLACE FUNCTION public.admin_list_disputes(p_limit integer DEFAULT 100, p_cursor timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN (
    WITH page AS (
      SELECT x.*, row_number() OVER (ORDER BY x.created_at DESC, x.id DESC) AS rn
      FROM public.contradictions x
      WHERE x.status = 'FLAGGED' AND (p_cursor IS NULL OR x.created_at < p_cursor)
      ORDER BY x.created_at DESC, x.id DESC LIMIT v_limit + 1)
    SELECT jsonb_build_object(
      'rows', coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'case_id', p.case_id, 'case_title', c.title, 'status', p.status, 'created_at', p.created_at,
        'summary', left(concat_ws(' vs ', ca.claim_text, cb.claim_text), 180),
        'source_documents', (SELECT coalesce(jsonb_agg(DISTINCT d.name), '[]'::jsonb) FROM public.documents d
          WHERE d.id IN (ca.document_id, cb.document_id))
      ) ORDER BY p.rn) FILTER (WHERE p.rn <= v_limit), '[]'::jsonb),
      'total', (SELECT count(*) FROM public.contradictions WHERE status = 'FLAGGED'),
      'next_cursor', CASE WHEN count(*) > v_limit THEN max(p.created_at) FILTER (WHERE p.rn = v_limit) END
    ) FROM page p
    LEFT JOIN public.cases c ON c.id = p.case_id
    LEFT JOIN public.extracted_claims ca ON ca.id = p.claim_a_id
    LEFT JOIN public.extracted_claims cb ON cb.id = p.claim_b_id);
END $$;

-- Owner drilldown into one dispute: full case reference, both claim texts, and their
-- source documents (names + ids) so review traces to the uploaded evidence, owner-gated.
CREATE OR REPLACE FUNCTION public.admin_get_dispute(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN (SELECT jsonb_build_object(
    'id', x.id, 'status', x.status, 'created_at', x.created_at,
    'case_id', c.id, 'case_title', c.title, 'tenant_id', c.tenant_id,
    'claim_a', ca.claim_text, 'claim_b', cb.claim_text,
    'claim_a_document', jsonb_build_object('id', da.id, 'name', da.name),
    'claim_b_document', jsonb_build_object('id', db.id, 'name', db.name)
  ) FROM public.contradictions x
  JOIN public.cases c ON c.id = x.case_id
  LEFT JOIN public.extracted_claims ca ON ca.id = x.claim_a_id
  LEFT JOIN public.extracted_claims cb ON cb.id = x.claim_b_id
  LEFT JOIN public.documents da ON da.id = ca.document_id
  LEFT JOIN public.documents db ON db.id = cb.document_id
  WHERE x.id = p_id);
END $$;

REVOKE ALL ON FUNCTION public.admin_list_tenants(integer, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_users(integer, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_cases(integer, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_disputes(integer, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_get_dispute(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_tenants(integer, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_users(integer, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_cases(integer, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_disputes(integer, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_dispute(uuid) TO authenticated;
COMMIT;
SELECT 'platform_admin_applied' AS result;
