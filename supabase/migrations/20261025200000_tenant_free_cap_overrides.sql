-- Owner-settable per-workspace daily cap on FREE extraction attempts (handover requirement:
-- "per-tenant AI limits exist, and the owner can set them without a developer"). Builds on
-- 20261024221000: the per-attempt reservation and Pacific day boundary are unchanged.
-- Resolution order inside reserve_free_extraction_attempt: this table's override for the
-- tenant wins when set; otherwise the app-supplied default (env CLAIM_FREE_WORKSPACE_DAILY_
-- ATTEMPTS, itself defaulting to 10) applies. NULL override = inherit the default. The
-- fail-closed rule is unchanged: an effective cap that is NULL or <= 0 means no free
-- attempts. An explicit owner override is deliberate configuration and therefore applies
-- even when the env default is unset or invalid. RPC-only table: RLS on, zero policies,
-- no direct grants; only platform admins can read or write it, through the functions here.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('cargoiq-tenant-free-caps-v1',0));

CREATE TABLE IF NOT EXISTS public.tenant_free_caps (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  daily_attempts integer CHECK (daily_attempts IS NULL OR (daily_attempts >= 0 AND daily_attempts <= 10000)),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tenant_free_caps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_free_caps FROM anon;

-- Same contract as 20261024221000 plus two states: 'tenant_disabled' (owner set this
-- workspace to 0) and global-off precedence ('no_cap_configured' now also wins over any
-- per-workspace row). Returns:
--   'reserved' / 'over_cap' / 'no_cap_configured' / 'tenant_disabled'.
CREATE OR REPLACE FUNCTION public.reserve_free_extraction_attempt(p_tenant_id uuid, p_daily_cap integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_day date; v_attempts integer; v_cap integer;
BEGIN
  IF NOT public.is_tenant_member(p_tenant_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  -- Global control first: an off/unconfigured global default overrides every per-workspace
  -- row. An invalid global control fails closed here and is never silently overruled.
  IF p_daily_cap IS NULL OR p_daily_cap <= 0 THEN RETURN 'no_cap_configured'; END IF;
  SELECT c.daily_attempts INTO v_cap FROM public.tenant_free_caps c WHERE c.tenant_id = p_tenant_id;
  -- Explicit per-workspace off (0) is a distinct state from the daily cap being exhausted.
  IF v_cap IS NOT NULL AND v_cap <= 0 THEN RETURN 'tenant_disabled'; END IF;
  v_cap := coalesce(v_cap, p_daily_cap);
  v_day := (now() AT TIME ZONE 'America/Los_Angeles')::date;
  PERFORM pg_advisory_xact_lock(hashtextextended('free-extraction-cap-' || p_tenant_id::text, 0));
  INSERT INTO public.free_extraction_attempts(tenant_id, day, attempts) VALUES (p_tenant_id, v_day, 0)
    ON CONFLICT (tenant_id, day) DO NOTHING;
  SELECT attempts INTO v_attempts FROM public.free_extraction_attempts
    WHERE tenant_id = p_tenant_id AND day = v_day;
  IF v_attempts >= v_cap THEN RETURN 'over_cap'; END IF;
  UPDATE public.free_extraction_attempts SET attempts = attempts + 1
    WHERE tenant_id = p_tenant_id AND day = v_day;
  RETURN 'reserved';
END $$;
REVOKE ALL ON FUNCTION public.reserve_free_extraction_attempt(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_free_extraction_attempt(uuid, integer) TO authenticated;

-- Owner sets or clears one workspace's cap. NULL clears the override (inherit the global
-- default); 0 explicitly turns free extraction OFF for that workspace; 1..10000 sets its
-- daily limit; anything else is rejected. The row records who changed it and when,
-- including clears, so the latest state is always auditable.
CREATE OR REPLACE FUNCTION public.admin_set_tenant_free_cap(p_tenant_id uuid, p_daily_attempts integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_daily_attempts IS NOT NULL AND (p_daily_attempts < 0 OR p_daily_attempts > 10000) THEN
    RAISE EXCEPTION 'INVALID_CAP';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN RAISE EXCEPTION 'UNKNOWN_TENANT'; END IF;
  INSERT INTO public.tenant_free_caps(tenant_id, daily_attempts, updated_by, updated_at)
  VALUES (p_tenant_id, p_daily_attempts, auth.uid(), now())
  ON CONFLICT (tenant_id) DO UPDATE
    SET daily_attempts = EXCLUDED.daily_attempts, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
  RETURN jsonb_build_object('tenant_id', p_tenant_id, 'daily_attempts', p_daily_attempts);
END $$;
REVOKE ALL ON FUNCTION public.admin_set_tenant_free_cap(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_tenant_free_cap(uuid, integer) TO authenticated;

-- Owner reads every workspace's setting and today's usage (bounded; a settings panel,
-- not a report). Effective limit = per-workspace setting when set (0 = off), else the
-- global default - resolution happens in the app, which owns the global default.
CREATE OR REPLACE FUNCTION public.admin_list_tenant_free_caps()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN (
    WITH t AS (
      SELECT tn.id, tn.name FROM public.tenants tn ORDER BY tn.name, tn.id LIMIT 500
    )
    SELECT jsonb_build_object(
      'rows', coalesce(jsonb_agg(jsonb_build_object(
        'tenant_id', t.id,
        'name', t.name,
        'override', c.daily_attempts,
        'attempts_today', coalesce(a.attempts, 0)
      ) ORDER BY t.name, t.id), '[]'::jsonb),
      'total', (SELECT count(*) FROM public.tenants)
    )
    FROM t
    LEFT JOIN public.tenant_free_caps c ON c.tenant_id = t.id
    LEFT JOIN public.free_extraction_attempts a
      ON a.tenant_id = t.id AND a.day = (now() AT TIME ZONE 'America/Los_Angeles')::date
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_list_tenant_free_caps() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_tenant_free_caps() TO authenticated;
COMMIT;
