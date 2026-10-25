-- Batched variant of has_unresolved_operational_clocks for list views (audit item 10).
-- listCases called the per-case RPC once per case (N+1). Same logic, set-based:
-- returns the subset of the given case ids that currently have unresolved
-- conflicting operational clock groups. Read-only, SECURITY INVOKER like the
-- original, so the caller's RLS scope still applies.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='30s';
DO $pre$
BEGIN
  IF to_regclass('public.operational_clocks') IS NULL OR to_regclass('public.clock_reconciliations') IS NULL THEN
    RAISE EXCEPTION 'operational_clocks/clock_reconciliations missing - wrong project or base schema not applied';
  END IF;
END $pre$;
CREATE OR REPLACE FUNCTION public.cases_with_unresolved_operational_clocks(_case_ids uuid[])
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
  SELECT DISTINCT g.case_id FROM (
    SELECT case_id, physical_reference, kind, array_agg(id ORDER BY id) AS ids, count(DISTINCT occurred_at) AS timestamps
    FROM public.operational_clocks WHERE case_id = ANY(_case_ids)
    GROUP BY case_id, physical_reference, kind) g
  LEFT JOIN LATERAL(
    SELECT * FROM public.clock_reconciliations r
    WHERE r.case_id = g.case_id AND r.physical_reference = g.physical_reference AND r.kind = g.kind
    ORDER BY version DESC LIMIT 1) d ON true
  WHERE g.timestamps > 1 AND (d.id IS NULL OR d.considered_clock_ids IS DISTINCT FROM g.ids)
$$;
REVOKE ALL ON FUNCTION public.cases_with_unresolved_operational_clocks(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cases_with_unresolved_operational_clocks(uuid[]) TO authenticated;
COMMIT;
SELECT 'batched_clock_check_applied' AS result;
