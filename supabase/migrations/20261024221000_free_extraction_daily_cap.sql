-- Per-workspace daily cap on FREE third-party extraction attempts (abuse protection for the
-- shared provider project quota; NOT a paid-spend mechanism). Semantics: one slot is consumed
-- per ACTUAL outbound free-provider request, recorded BEFORE the request, never refunded on
-- failure - the cap bounds attempts, not successful extractions, so no success count is ever
-- promised from a quota guess. The day boundary is the provider's own reset (midnight
-- America/Los_Angeles, matching the Gemini API RPD reset), so our allowance window cannot
-- straddle two provider windows. Atomic: advisory-lock-serialized check+increment per tenant,
-- so concurrent requests can never both pass an exhausted cap. Fail closed: no configured cap
-- (NULL/<=0) = no free attempts. RPC-only table: RLS on, zero policies, no direct grants.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('cargoiq-free-daily-cap-v1',0));

CREATE TABLE IF NOT EXISTS public.free_extraction_attempts (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  day date NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  PRIMARY KEY (tenant_id, day)
);
ALTER TABLE public.free_extraction_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.free_extraction_attempts FROM anon;

-- reserve_free_extraction_attempt: one atomic check+increment. Returns:
--   'reserved'          slot consumed, provider request may proceed
--   'over_cap'          daily allowance exhausted; caller falls back to local text import
--   'no_cap_configured' cap missing/invalid; fail closed, no free attempts
CREATE OR REPLACE FUNCTION public.reserve_free_extraction_attempt(p_tenant_id uuid, p_daily_cap integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_day date; v_attempts integer;
BEGIN
  IF NOT public.is_tenant_member(p_tenant_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_daily_cap IS NULL OR p_daily_cap <= 0 THEN RETURN 'no_cap_configured'; END IF;
  v_day := (now() AT TIME ZONE 'America/Los_Angeles')::date;
  PERFORM pg_advisory_xact_lock(hashtextextended('free-extraction-cap-' || p_tenant_id::text, 0));
  INSERT INTO public.free_extraction_attempts(tenant_id, day, attempts) VALUES (p_tenant_id, v_day, 0)
    ON CONFLICT (tenant_id, day) DO NOTHING;
  SELECT attempts INTO v_attempts FROM public.free_extraction_attempts
    WHERE tenant_id = p_tenant_id AND day = v_day;
  IF v_attempts >= p_daily_cap THEN RETURN 'over_cap'; END IF;
  UPDATE public.free_extraction_attempts SET attempts = attempts + 1
    WHERE tenant_id = p_tenant_id AND day = v_day;
  RETURN 'reserved';
END $$;
REVOKE ALL ON FUNCTION public.reserve_free_extraction_attempt(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_free_extraction_attempt(uuid, integer) TO authenticated;
COMMIT;
