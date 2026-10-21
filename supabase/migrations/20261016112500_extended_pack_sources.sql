-- Extend the existing atomic source comparison, never bypass it. Historical packs stay immutable.
BEGIN;
SET LOCAL lock_timeout='10s';
CREATE OR REPLACE FUNCTION public.current_pack_source(_case_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT jsonb_build_object(
  'case',(SELECT to_jsonb(c) FROM public.cases c WHERE id=_case_id),
  'documents',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.documents r WHERE case_id=_case_id),'[]'::jsonb),
  'operationalDefinitions',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.operational_definitions r WHERE case_id=_case_id),'[]'::jsonb),
  'operationalClocks',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.operational_clocks r WHERE case_id=_case_id),'[]'::jsonb),
  'appointmentAttributions',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.appointment_attributions r WHERE case_id=_case_id),'[]'::jsonb),
  'kpiDefinitions',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.kpi_definitions r WHERE case_id=_case_id),'[]'::jsonb),
  'crossPartyMatches',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.cross_party_matches r WHERE case_id=_case_id),'[]'::jsonb),
  'evidenceGapHistory',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.evidence_gap_entries r WHERE case_id=_case_id),'[]'::jsonb),
  'eventIdentityReviews',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.cross_party_match_reviews r WHERE case_id=_case_id),'[]'::jsonb),
  'clockReconciliations',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.clock_reconciliations r WHERE case_id=_case_id),'[]'::jsonb),
  'claims',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.extracted_claims r WHERE case_id=_case_id),'[]'::jsonb),
  'contradictions',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.contradictions r WHERE case_id=_case_id),'[]'::jsonb),
  'timeline',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.timeline_events r WHERE case_id=_case_id),'[]'::jsonb),
  'externalObservations',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.external_observations r WHERE case_id=_case_id),'[]'::jsonb),
  'financialCalculations',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.financial_calculations r WHERE case_id=_case_id),'[]'::jsonb),
  'verifiedClaims',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.extracted_claims r WHERE case_id=_case_id AND status='VERIFIED'),'[]'::jsonb),
  'countSourceRecords',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.count_source_records r WHERE case_id=_case_id),'[]'::jsonb),
  'countRuleVersions',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.count_rule_versions r WHERE case_id=_case_id),'[]'::jsonb),
  'countComparisons',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.count_comparison_definitions r WHERE case_id=_case_id),'[]'::jsonb),
  'appointmentLifecycle',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.appointment_lifecycle r WHERE case_id=_case_id),'[]'::jsonb),
  'authorisedImports',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.authorised_imports r WHERE case_id=_case_id),'[]'::jsonb),
  'countEngineVersion','1',
  'approvals','[]'::jsonb,
  'truthRule','Public and independent observations are corroboration unless the source directly proves the event. Inference remains inference until human review.'
 )
$$;
COMMIT;
