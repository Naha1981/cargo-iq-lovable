-- Extraction usage accounting + spend-cap support (provider-neutral). When extraction
-- runs on a customer-billed provider key, every call is recorded here so a configured
-- monthly cap (commercial_rules rule_type='AI_SPEND_CAP') can be enforced app-side and
-- spend is reviewable per tenant. The provider's own hard limit (e.g. OpenAI project
-- spend limit) remains the outer enforcement; this table is the app's reservation layer.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('cargoiq-extraction-usage-v1',0));

CREATE TABLE IF NOT EXISTS public.extraction_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  case_id uuid REFERENCES public.cases(id),
  document_id uuid REFERENCES public.documents(id),
  provider text NOT NULL,
  model text,
  input_tokens integer,
  output_tokens integer,
  cost_usd_estimate numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.extraction_usage ENABLE ROW LEVEL SECURITY;
DO $pol$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.extraction_usage'::regclass AND polname='Tenant read extraction usage') THEN
    CREATE POLICY "Tenant read extraction usage" ON public.extraction_usage FOR SELECT TO authenticated USING(public.is_tenant_member(tenant_id));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.extraction_usage'::regclass AND polname='Tenant insert extraction usage') THEN
    CREATE POLICY "Tenant insert extraction usage" ON public.extraction_usage FOR INSERT TO authenticated WITH CHECK(public.is_tenant_member(tenant_id));
  END IF;
END $pol$;
COMMIT;
SELECT 'extraction_usage_applied' AS result;
