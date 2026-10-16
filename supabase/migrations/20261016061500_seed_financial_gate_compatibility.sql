-- CargoIQ additive onboarding compatibility fix. Review and back up first.
-- Removes ONLY the obsolete seeded financial run. Leaves existing records untouched.
-- Does not disable, bypass or weaken operational financial/pack gates.
-- Exact source guard aborts on drift or if already applied. Do not bypass.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('cargoiq-seed-financial-gate-fix',0));
DO $fix$
DECLARE before_def text;after_def text;needle text:=$old$
  INSERT INTO financial_calculations (tenant_id, case_id, calculation_type, rule_version, input_payload, result_payload, calculated_amount_minor, charged_amount_minor, variance_minor, currency, created_by) VALUES
    (_tenant,c,'DEMURRAGE','2026.09','{"start":"2026-09-06T14:20:00Z","release":"2026-09-13T10:05:00Z","freeDays":3,"dailyRate":4800}','{"chargeableDays":7,"total":33600}',3360000,5280000,1920000,'ZAR',_user);
$old$;
BEGIN
 IF to_regprocedure('public.seed_demo_case(uuid,uuid)') IS NULL THEN RAISE EXCEPTION 'Seed function absent; inspect onboarding before applying'; END IF;
 SELECT pg_get_functiondef('public.seed_demo_case(uuid,uuid)'::regprocedure) INTO before_def;
 IF length(before_def)-length(replace(before_def,needle,''))<>length(needle) THEN RAISE EXCEPTION 'Expected seeded financial INSERT differs or already removed; no changes applied. Inspect pg_get_functiondef first.'; END IF;
 after_def:=replace(before_def,needle,'  -- No seeded financial run: flagged source evidence must remain blocked.');
 -- Exactly one guarded replacement; rest of function including flags/audit is preserved.
 EXECUTE after_def;
END
$fix$;
COMMIT;
SELECT 'seed_financial_gate_fix_applied' AS result,
 strpos(pg_get_functiondef('public.seed_demo_case(uuid,uuid)'::regprocedure),'INSERT INTO financial_calculations')=0 AS no_seeded_money,
 EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.financial_calculations'::regclass AND tgname='operational_evidence_gate' AND NOT tgisinternal) AS money_gate_still_attached;
