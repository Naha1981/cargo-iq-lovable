-- Safe after either CargoIQ Brenda bundle. Run once; safe to repeat.
-- No data edits. Any existing invalid record blocks and rolls this whole patch back.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF to_regclass('public.appointment_lifecycle') IS NULL OR to_regclass('public.count_rule_versions') IS NULL THEN RAISE EXCEPTION 'Apply the Brenda register bundle first';END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.appointment_lifecycle'::regclass AND conname='appointment_slot_window_v2') THEN
  ALTER TABLE public.appointment_lifecycle ADD CONSTRAINT appointment_slot_window_v2 CHECK((record_type='SLOT' AND start_at IS NOT NULL AND end_at IS NOT NULL AND end_at>start_at) OR (record_type<>'SLOT' AND start_at IS NULL AND end_at IS NULL)) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.count_rule_versions'::regclass AND conname='count_rule_metric_basis_v2') THEN
  ALTER TABLE public.count_rule_versions ADD CONSTRAINT count_rule_metric_basis_v2 CHECK((metric='HATCH_COVER' AND input_basis IN ('HATCH_OPERATION','INDIVIDUAL_LIFT')) OR (metric='TRUCK_VISIT' AND input_basis='TRUCK_VISIT') OR (metric='CONTAINER_DELIVERY' AND input_basis IN ('CONTAINER','TEU')) OR (metric='GATE_COUNT' AND input_basis='GATE_EVENT')) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.count_rule_versions'::regclass AND conname='count_rule_gate_scope_v2') THEN
  ALTER TABLE public.count_rule_versions ADD CONSTRAINT count_rule_gate_scope_v2 CHECK((metric='GATE_COUNT' AND cardinality(gate_kinds)>0) OR (metric<>'GATE_COUNT' AND cardinality(gate_kinds)=0)) NOT VALID;
 END IF;
END $$;
ALTER TABLE public.appointment_lifecycle VALIDATE CONSTRAINT appointment_slot_window_v2;
ALTER TABLE public.count_rule_versions VALIDATE CONSTRAINT count_rule_metric_basis_v2;
ALTER TABLE public.count_rule_versions VALIDATE CONSTRAINT count_rule_gate_scope_v2;
CREATE OR REPLACE FUNCTION public.guard_count_register() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE prior jsonb; identity text; latest_id uuid; latest_version integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Count registers are append-only'; END IF;
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND tenant_id=NEW.tenant_id AND role IN ('admin','investigator')) THEN RAISE EXCEPTION 'Investigator access required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.cases WHERE id=NEW.case_id AND tenant_id=NEW.tenant_id) OR NOT EXISTS(SELECT 1 FROM public.documents WHERE id=NEW.source_document_id AND case_id=NEW.case_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'Evidence must belong to case and tenant'; END IF;
 IF TG_TABLE_NAME='count_source_records' THEN
  IF NOT EXISTS(SELECT 1 FROM public.documents WHERE id=NEW.source_document_id AND lower(trim(source_party))=lower(trim(NEW.party))) THEN RAISE EXCEPTION 'Count party must match the source document organization'; END IF;
  identity:=NEW.party||':'||NEW.physical_reference||':'||NEW.metric||':'||NEW.gate_kind;
 ELSE IF cardinality(NEW.gate_kinds)<>(SELECT count(DISTINCT k) FROM unnest(NEW.gate_kinds) k) THEN RAISE EXCEPTION 'Duplicate gate filters'; END IF; identity:=NEW.name; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(TG_TABLE_NAME||':'||NEW.case_id::text||':'||identity,0));
 IF TG_TABLE_NAME='count_source_records' THEN
  SELECT id,version INTO latest_id,latest_version FROM public.count_source_records WHERE case_id=NEW.case_id AND party=NEW.party AND physical_reference=NEW.physical_reference AND metric=NEW.metric AND gate_kind=NEW.gate_kind ORDER BY version DESC LIMIT 1;
 ELSE SELECT id,version INTO latest_id,latest_version FROM public.count_rule_versions WHERE case_id=NEW.case_id AND name=NEW.name ORDER BY version DESC LIMIT 1;
 END IF;
 IF NEW.supersedes_id IS DISTINCT FROM latest_id THEN RAISE EXCEPTION 'Register changed; supersede latest version'; END IF;
 NEW.version:=coalesce(latest_version,0)+1;NEW.created_by:=auth.uid();NEW.created_at:=now();RETURN NEW;
END $$;
COMMIT;
SELECT 'brenda_guard_followup_applied' AS result,
 (SELECT count(*)=3 FROM pg_constraint WHERE conname IN ('appointment_slot_window_v2','count_rule_metric_basis_v2','count_rule_gate_scope_v2') AND convalidated) AS guards_validated;
