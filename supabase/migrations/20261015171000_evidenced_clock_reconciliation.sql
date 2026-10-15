CREATE TABLE public.clock_reconciliations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),case_id uuid NOT NULL REFERENCES public.cases(id),
 physical_reference text NOT NULL,kind text NOT NULL,selected_clock_id uuid NOT NULL REFERENCES public.operational_clocks(id),
 considered_clock_ids uuid[] NOT NULL,explanation text NOT NULL CHECK(length(trim(explanation)) BETWEEN 10 AND 4000),source_document_id uuid NOT NULL REFERENCES public.documents(id),
 source_reference text NOT NULL CHECK(length(trim(source_reference)) BETWEEN 3 AND 1000),version integer NOT NULL,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(case_id,physical_reference,kind,version)
);
ALTER TABLE public.clock_reconciliations ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT ON public.clock_reconciliations TO authenticated;GRANT ALL ON public.clock_reconciliations TO service_role;
CREATE POLICY "Tenant read reconciliations" ON public.clock_reconciliations FOR SELECT TO authenticated USING(public.is_tenant_member(tenant_id));
CREATE POLICY "Investigators reconcile clocks" ON public.clock_reconciliations FOR INSERT TO authenticated WITH CHECK(EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND tenant_id=clock_reconciliations.tenant_id AND role IN ('admin','investigator')));
-- Serialize clock additions and decisions on the same physical event/kind.
CREATE OR REPLACE FUNCTION public.lock_clock_group() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('case-evidence:'||NEW.case_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('clock-group:'||NEW.case_id::text||':'||NEW.physical_reference||':'||NEW.kind,0));RETURN NEW;
END $$;
CREATE TRIGGER a_lock_clock_group BEFORE INSERT ON public.operational_clocks FOR EACH ROW EXECUTE FUNCTION public.lock_clock_group();
CREATE OR REPLACE FUNCTION public.guard_clock_reconciliation() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE selected public.operational_clocks;
BEGIN
 IF TG_OP<>'INSERT' OR auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated append-only reconciliation required'; END IF;
 SELECT * INTO selected FROM public.operational_clocks WHERE id=NEW.selected_clock_id AND case_id=NEW.case_id AND tenant_id=NEW.tenant_id;
 IF selected.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.documents WHERE id=NEW.source_document_id AND case_id=NEW.case_id AND tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'Selected clock and supporting document must belong to case and tenant'; END IF;
 NEW.physical_reference:=selected.physical_reference;NEW.kind:=selected.kind;
 PERFORM pg_advisory_xact_lock(hashtextextended('case-evidence:'||NEW.case_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('clock-group:'||NEW.case_id::text||':'||NEW.physical_reference||':'||NEW.kind,0));
 SELECT array_agg(id ORDER BY id) INTO NEW.considered_clock_ids FROM public.operational_clocks WHERE case_id=NEW.case_id AND tenant_id=NEW.tenant_id AND physical_reference=NEW.physical_reference AND kind=NEW.kind;
 SELECT coalesce(max(version),0)+1 INTO NEW.version FROM public.clock_reconciliations WHERE case_id=NEW.case_id AND physical_reference=NEW.physical_reference AND kind=NEW.kind;
 NEW.created_by:=auth.uid();NEW.created_at:=now();RETURN NEW;
END $$;
CREATE TRIGGER guard_clock_reconciliation BEFORE INSERT OR UPDATE OR DELETE ON public.clock_reconciliations FOR EACH ROW EXECUTE FUNCTION public.guard_clock_reconciliation();
CREATE OR REPLACE FUNCTION public.audit_clock_reconciliation() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 INSERT INTO public.audit_log(tenant_id,case_id,actor_user_id,action,entity_type,entity_id,payload) VALUES(NEW.tenant_id,NEW.case_id,auth.uid(),'CLOCK_EVIDENCE_RECONCILED','clock_reconciliation',NEW.id,to_jsonb(NEW));RETURN NEW;
END $$;
CREATE TRIGGER audit_clock_reconciliation AFTER INSERT ON public.clock_reconciliations FOR EACH ROW EXECUTE FUNCTION public.audit_clock_reconciliation();
CREATE OR REPLACE FUNCTION public.has_unresolved_operational_clocks(_case_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT EXISTS(
  SELECT 1 FROM (SELECT physical_reference,kind,array_agg(id ORDER BY id) AS ids,count(DISTINCT occurred_at) AS timestamps FROM public.operational_clocks WHERE case_id=_case_id GROUP BY physical_reference,kind) g
  LEFT JOIN LATERAL(SELECT * FROM public.clock_reconciliations r WHERE r.case_id=_case_id AND r.physical_reference=g.physical_reference AND r.kind=g.kind ORDER BY version DESC LIMIT 1) d ON true
  WHERE g.timestamps>1 AND (d.id IS NULL OR d.considered_clock_ids IS DISTINCT FROM g.ids)
 )
$$;
REVOKE ALL ON FUNCTION public.has_unresolved_operational_clocks(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_unresolved_operational_clocks(uuid) TO authenticated;
-- Final persistence gate protects direct API writes as well as the app server.
CREATE OR REPLACE FUNCTION public.enforce_operational_evidence_gate() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND tenant_id=NEW.tenant_id AND role IN ('admin','investigator')) THEN RAISE EXCEPTION 'Investigator access required'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('case-evidence:'||NEW.case_id::text,0));
 IF public.has_unresolved_operational_clocks(NEW.case_id) OR EXISTS(SELECT 1 FROM public.contradictions WHERE case_id=NEW.case_id AND status='FLAGGED') THEN RAISE EXCEPTION 'BLOCKED: reconcile unresolved clock evidence and contradictions first'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER operational_evidence_gate BEFORE INSERT ON public.financial_calculations FOR EACH ROW EXECUTE FUNCTION public.enforce_operational_evidence_gate();
CREATE TRIGGER operational_evidence_gate BEFORE INSERT OR UPDATE OF status ON public.evidence_packs FOR EACH ROW EXECUTE FUNCTION public.enforce_operational_evidence_gate();
CREATE OR REPLACE FUNCTION public.immutable_financial_audit_run() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN RAISE EXCEPTION 'Financial audit runs are append-only; save a new run rather than rewrite history';END $$;
CREATE TRIGGER immutable_financial_audit_run BEFORE UPDATE OR DELETE ON public.financial_calculations FOR EACH ROW EXECUTE FUNCTION public.immutable_financial_audit_run();
