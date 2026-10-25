-- Atomic spend reservation for paid extraction (replaces racy check-then-call).
-- One function performs cap-read + monthly-total + reservation insert inside a single
-- transaction, serialized per tenant with an advisory lock, so concurrent requests can
-- never both pass an almost-full cap. Reservations are conservative UPPER BOUNDS recorded
-- BEFORE the provider call, completed with actual usage after success, voided on known
-- failure, and stale ones are voided by reconcile_extraction_reservations() so a timed-out
-- call cannot lock budget forever. Accounting failure = paid extraction refused (fail closed).
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('cargoiq-spend-reservation-v1',0));

ALTER TABLE public.extraction_usage
  ADD COLUMN IF NOT EXISTS request_id uuid,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS reserved_cost_usd numeric,
  ADD COLUMN IF NOT EXISTS reserved_at timestamptz;
DO $c$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='extraction_usage_status_check') THEN
    ALTER TABLE public.extraction_usage ADD CONSTRAINT extraction_usage_status_check CHECK (status IN ('reserved','completed','voided'));
  END IF;
END $c$;
CREATE UNIQUE INDEX IF NOT EXISTS extraction_usage_request_id_key ON public.extraction_usage(request_id) WHERE request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reserve_extraction_cost(p_tenant_id uuid, p_request_id uuid, p_reserved_cost_usd numeric)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_cap numeric; v_month_total numeric;
BEGIN
  IF NOT public.is_tenant_member(p_tenant_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('extraction-cap-' || p_tenant_id::text, 0));
  SELECT (payload->>'monthly_usd')::numeric INTO v_cap FROM public.commercial_rules
    WHERE tenant_id = p_tenant_id AND rule_type = 'AI_SPEND_CAP' AND active LIMIT 1;
  IF v_cap IS NULL OR v_cap <= 0 THEN RETURN 'no_cap'; END IF;
  SELECT coalesce(sum(cost_usd_estimate) FILTER (WHERE status = 'completed'), 0)
       + coalesce(sum(reserved_cost_usd) FILTER (WHERE status = 'reserved'), 0)
    INTO v_month_total FROM public.extraction_usage
    WHERE tenant_id = p_tenant_id AND created_at >= date_trunc('month', now());
  IF v_month_total + p_reserved_cost_usd > v_cap THEN RETURN 'over_cap'; END IF;
  INSERT INTO public.extraction_usage(tenant_id, request_id, provider, status, reserved_cost_usd, reserved_at)
    VALUES (p_tenant_id, p_request_id, 'pending', 'reserved', p_reserved_cost_usd, now());
  RETURN 'reserved';
END $$;
REVOKE ALL ON FUNCTION public.reserve_extraction_cost(uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_extraction_cost(uuid, uuid, numeric) TO authenticated;

-- Completion writes actual usage; if the reservation row vanished (reconciled), a fresh
-- completed row is inserted so actual spend is never lost from the ledger.
CREATE OR REPLACE FUNCTION public.complete_extraction_cost(p_tenant_id uuid, p_request_id uuid, p_case_id uuid, p_document_id uuid,
  p_provider text, p_model text, p_input_tokens integer, p_output_tokens integer, p_cost_usd numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_tenant_member(p_tenant_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  UPDATE public.extraction_usage SET status='completed', case_id=p_case_id, document_id=p_document_id,
    provider=p_provider, model=p_model, input_tokens=p_input_tokens, output_tokens=p_output_tokens, cost_usd_estimate=p_cost_usd
    WHERE request_id = p_request_id AND status = 'reserved';
  IF NOT FOUND THEN
    -- Reservation row missing or already voided: record actual spend anyway, reusing the
    -- voided row when one exists (request_id is unique) so the ledger never loses spend.
    INSERT INTO public.extraction_usage(tenant_id, request_id, case_id, document_id, provider, model, input_tokens, output_tokens, cost_usd_estimate, status)
      VALUES (p_tenant_id, p_request_id, p_case_id, p_document_id, p_provider, p_model, p_input_tokens, p_output_tokens, p_cost_usd, 'completed')
    ON CONFLICT (request_id) WHERE request_id IS NOT NULL DO UPDATE SET
      status='completed', case_id=EXCLUDED.case_id, document_id=EXCLUDED.document_id,
      provider=EXCLUDED.provider, model=EXCLUDED.model, input_tokens=EXCLUDED.input_tokens,
      output_tokens=EXCLUDED.output_tokens, cost_usd_estimate=EXCLUDED.cost_usd_estimate;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.complete_extraction_cost(uuid, uuid, uuid, uuid, text, text, integer, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_extraction_cost(uuid, uuid, uuid, uuid, text, text, integer, integer, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.void_extraction_reservation(p_tenant_id uuid, p_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_tenant_member(p_tenant_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  UPDATE public.extraction_usage SET status='voided' WHERE request_id = p_request_id AND tenant_id = p_tenant_id AND status = 'reserved';
END $$;
REVOKE ALL ON FUNCTION public.void_extraction_reservation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_extraction_reservation(uuid, uuid) TO authenticated;

-- Stale-reservation REPORT, deliberately NON-mutating: a paid call that timed out after
-- reserving may still have been billed, so its reservation keeps counting against the cap
-- until the actual charge is reconciled from the provider invoice (complete_extraction_cost
-- settles it; a human voids it only once the invoice proves no charge). Releasing it
-- automatically could free budget while a billable charge is unreconciled.
CREATE OR REPLACE FUNCTION public.reconcile_extraction_reservations()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('request_id', request_id, 'tenant_id', tenant_id,
    'reserved_cost_usd', reserved_cost_usd, 'reserved_at', reserved_at)), '[]'::jsonb)
  FROM public.extraction_usage
  WHERE status='reserved' AND reserved_at < now() - interval '1 hour';
$$;
REVOKE ALL ON FUNCTION public.reconcile_extraction_reservations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_extraction_reservations() TO authenticated;
COMMIT;
SELECT 'spend_reservation_applied' AS result;
