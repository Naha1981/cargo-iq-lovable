-- PROPOSAL ONLY. NOT APPROVED FOR ANY HOSTED DATABASE.
-- Whole transaction only. Reviewed baseline and final exact fingerprints required.
-- Preserves canonical comparison, hash, role/clock/contradiction gates and historical packs.
-- One tenant advisory lock serializes integrated-source writes with final pack source recheck.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL search_path='';
DO $pre$ declare fingerprint text; begin
if not exists(select 1 from pg_catalog.pg_roles where rolname=current_user and rolsuper)
   and (not pg_catalog.pg_has_role(current_user,(select proowner from pg_catalog.pg_proc where oid='public.current_pack_source(uuid)'::regprocedure),'USAGE')
     or exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname=any(ARRAY['risk_events','risk_event_case_links','risk_alerts','risk_alert_verifications','cost_recovery_links','geospatial_findings','geospatial_finding_events','scene_assets','scene_asset_events','recovery_findings','recovery_finding_events','simulation_scenarios','simulation_scenario_events'])
       and not pg_catalog.pg_has_role(current_user,c.relowner,'USAGE')))
then raise exception 'DATABASE_SCHEMA_OWNER_REQUIRED'; end if;
select md5(catalog::text) into fingerprint from (
select jsonb_build_object(
 'tables', (select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'constraints',(select jsonb_agg(pg_catalog.pg_get_constraintdef(k.oid) order by k.conname) from pg_catalog.pg_constraint k where k.conrelid=c.oid),'policies',(select jsonb_agg(jsonb_build_object('name',p.polname,'cmd',p.polcmd,'roles',(select array_agg(r.rolname order by r.rolname) from pg_catalog.pg_roles r where r.oid=any(p.polroles)),'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid),'check',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_catalog.pg_policy p where p.polrelid=c.oid),'triggers',(select jsonb_agg(jsonb_build_object('definition',pg_catalog.pg_get_triggerdef(t.oid),'enabled',t.tgenabled) order by t.tgname) from pg_catalog.pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)) order by c.relname) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(ARRAY['simulation_scenarios','simulation_scenario_events','recovery_findings','recovery_finding_events','scene_assets','scene_asset_events','geospatial_findings','geospatial_finding_events'])),
 'functions',(select jsonb_agg(pg_catalog.pg_get_functiondef(p.oid) order by p.proname) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('cargoiq_feature_atomic_audit','cargoiq_create_recovery_batch'))
) as catalog
  ) expected_catalog;

if fingerprint <> '1051f064af0ec88d1389a41ab22b2df5' then raise exception 'BASELINE_FEATURE_CATALOG_MISMATCH'; end if;
if md5(pg_get_functiondef('public.current_pack_source(uuid)'::regprocedure)) <> 'de2e2478f6dbdff475e37934256ef100' or md5(pg_get_functiondef('public.persist_evidence_pack_atomic(uuid,text)'::regprocedure)) <> 'b16b18a7876a440708da7c07051f263b' then raise exception 'BASELINE_PACK_FUNCTION_MISMATCH'; end if;
end $pre$;

create function public.lock_integrated_pack_source() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare r jsonb; t uuid; ref jsonb;
begin
  for t in select distinct x from unnest(array[
    case when tg_op <> 'INSERT' then (to_jsonb(old)->>'tenant_id')::uuid end,
    case when tg_op <> 'DELETE' then (to_jsonb(new)->>'tenant_id')::uuid end
  ]) x where x is not null order by x loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('tenant-feature-evidence:'||t::text,0)) then raise exception 'PACK_SOURCE_BUSY_RETRY_TRANSACTION' using errcode='40001'; end if;
  end loop;
  if tg_op <> 'DELETE' then
    r := to_jsonb(new);
    if tg_op='UPDATE' and tg_table_name in ('geospatial_findings','scene_assets','recovery_findings','risk_alerts','risk_event_case_links','cost_recovery_links') and r->'case_id' is distinct from to_jsonb(old)->'case_id' then raise exception 'IMMUTABLE_FEATURE_CASE_ASSOCIATION'; end if;
    if tg_table_name='simulation_scenarios' then
      if tg_op='UPDATE' and (select coalesce(jsonb_agg(x order by x::text),'[]'::jsonb) from jsonb_array_elements(r->'evidence_refs') x where x->>'kind'='case') is distinct from (select coalesce(jsonb_agg(x order by x::text),'[]'::jsonb) from jsonb_array_elements(to_jsonb(old)->'evidence_refs') x where x->>'kind'='case') then raise exception 'IMMUTABLE_SCENARIO_CASE_ASSOCIATION'; end if;
      if jsonb_typeof(r->'evidence_refs') <> 'array' then raise exception 'SCENARIO_REFERENCES_ARRAY_REQUIRED'; end if;
      for ref in select value from jsonb_array_elements(r->'evidence_refs') where value->>'kind'='case' loop
        if not exists(select 1 from public.cases c where c.id::text=ref->>'id' and c.tenant_id=(r->>'tenant_id')::uuid)
        then raise exception 'SCENARIO_CASE_NOT_IN_WORKSPACE'; end if;
      end loop;
    end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function public.lock_integrated_pack_source() from public;

create trigger a0_integrated_pack_source_lock before insert or update or delete on public.risk_events for each row execute function public.lock_integrated_pack_source();
create trigger a0_integrated_pack_source_lock before insert or update or delete on public.risk_event_case_links for each row execute function public.lock_integrated_pack_source();
create trigger a0_integrated_pack_source_lock before insert or update or delete on public.risk_alerts for each row execute function public.lock_integrated_pack_source();
create trigger a0_integrated_pack_source_lock before insert or update or delete on public.risk_alert_verifications for each row execute function public.lock_integrated_pack_source();
create trigger a0_integrated_pack_source_lock before insert or update or delete on public.cost_recovery_links for each row execute function public.lock_integrated_pack_source();
create trigger a0_integrated_pack_source_lock before insert or update or delete on public.geospatial_findings for each row execute function public.lock_integrated_pack_source();
create trigger a0_integrated_pack_source_lock before insert or update or delete on public.geospatial_finding_events for each row execute function public.lock_integrated_pack_source();
create trigger a0_integrated_pack_source_lock before insert or update or delete on public.scene_assets for each row execute function public.lock_integrated_pack_source();
create trigger a0_integrated_pack_source_lock before insert or update or delete on public.scene_asset_events for each row execute function public.lock_integrated_pack_source();
create trigger a0_integrated_pack_source_lock before insert or update or delete on public.recovery_findings for each row execute function public.lock_integrated_pack_source();
create trigger a0_integrated_pack_source_lock before insert or update or delete on public.recovery_finding_events for each row execute function public.lock_integrated_pack_source();
create trigger a0_integrated_pack_source_lock before insert or update or delete on public.simulation_scenarios for each row execute function public.lock_integrated_pack_source();
create trigger a0_integrated_pack_source_lock before insert or update or delete on public.simulation_scenario_events for each row execute function public.lock_integrated_pack_source();
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
  'riskEventCaseLinks',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (select * from public.risk_event_case_links where case_id=_case_id and tenant_id=(select tenant_id from public.cases where id=_case_id)) r),'[]'::jsonb),
  'riskEvents',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (select e.* from public.risk_events e where e.tenant_id=(select tenant_id from public.cases where id=_case_id) and exists(select 1 from public.risk_event_case_links l where l.event_id=e.id and l.case_id=_case_id and l.tenant_id=e.tenant_id)) r),'[]'::jsonb),
  'riskAlerts',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (select * from public.risk_alerts where case_id=_case_id and tenant_id=(select tenant_id from public.cases where id=_case_id)) r),'[]'::jsonb),
  'riskAlertReviews',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (select v.* from public.risk_alert_verifications v join public.risk_alerts a on a.id=v.alert_id where a.case_id=_case_id and a.tenant_id=(select tenant_id from public.cases where id=_case_id) and v.tenant_id=a.tenant_id) r),'[]'::jsonb),
  'costRecoveryLinks',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (select l.* from public.cost_recovery_links l where l.case_id=_case_id and l.tenant_id=(select tenant_id from public.cases where id=_case_id) and (l.alert_id is null or exists(select 1 from public.risk_alerts a where a.id=l.alert_id and a.case_id=_case_id and a.tenant_id=l.tenant_id)) and (l.event_id is null or exists(select 1 from public.risk_event_case_links k where k.event_id=l.event_id and k.case_id=_case_id and k.tenant_id=l.tenant_id))) r),'[]'::jsonb),
  'geospatialFindings',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (select * from public.geospatial_findings where case_id=_case_id and tenant_id=(select tenant_id from public.cases where id=_case_id)) r),'[]'::jsonb),
  'geospatialFindingEvents',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (select e.* from public.geospatial_finding_events e join public.geospatial_findings f on f.id=e.finding_id where f.case_id=_case_id and f.tenant_id=(select tenant_id from public.cases where id=_case_id) and e.tenant_id=f.tenant_id and (e.detail->'after'->>'case_id')=_case_id::text and (e.detail->'before' is null or e.detail->'before'='null'::jsonb or (e.detail->'before'->>'case_id')=_case_id::text)) r),'[]'::jsonb),
  'sceneAssets',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (select * from public.scene_assets where case_id=_case_id and tenant_id=(select tenant_id from public.cases where id=_case_id)) r),'[]'::jsonb),
  'sceneAssetEvents',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (select e.* from public.scene_asset_events e join public.scene_assets a on a.id=e.asset_id where a.case_id=_case_id and a.tenant_id=(select tenant_id from public.cases where id=_case_id) and e.tenant_id=a.tenant_id and (e.detail->'after'->>'case_id')=_case_id::text and (e.detail->'before' is null or e.detail->'before'='null'::jsonb or (e.detail->'before'->>'case_id')=_case_id::text)) r),'[]'::jsonb),
  'recoveryFindings',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (select * from public.recovery_findings where case_id=_case_id and tenant_id=(select tenant_id from public.cases where id=_case_id)) r),'[]'::jsonb),
  'recoveryFindingEvents',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (select e.* from public.recovery_finding_events e join public.recovery_findings f on f.id=e.finding_id where f.case_id=_case_id and f.tenant_id=(select tenant_id from public.cases where id=_case_id) and e.tenant_id=f.tenant_id and (e.detail->'after'->>'case_id')=_case_id::text and (e.detail->'before' is null or e.detail->'before'='null'::jsonb or (e.detail->'before'->>'case_id')=_case_id::text)) r),'[]'::jsonb),
  'simulationScenarios',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (select s.id,s.name,s.scenario_type,s.status,s.severity,s.assumptions,(select coalesce(jsonb_agg(jsonb_build_object('kind','case','id',_case_id::text)),'[]'::jsonb) from jsonb_array_elements(s.evidence_refs) x where x->>'kind'='case' and x->>'id'=_case_id::text) evidence_refs,s.created_at,s.updated_at,s.created_by,s.tenant_id,s.starts_at,s.ends_at,s.decision_action,s.decision_summary,s.decided_by,s.decided_at, null::jsonb baseline_metrics,null::jsonb scenario_metrics,jsonb_build_object('withheld','Stored comparison metrics and machine reference arrays are operator-writable and not independently case-proven. Rerun and review in Simulation Lab; no comparison is asserted by this pack.') comparison_summary from public.simulation_scenarios s where s.tenant_id=(select tenant_id from public.cases where id=_case_id) and s.evidence_refs @> jsonb_build_array(jsonb_build_object('kind','case','id',_case_id::text)) and not exists(select 1 from jsonb_array_elements(s.evidence_refs) x where x->>'kind'='case' and x->>'id'<>_case_id::text)) r),'[]'::jsonb),
  'simulationScenarioEvents',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (select e.id,e.tenant_id,e.scenario_id,e.action,e.actor,e.created_at,jsonb_build_object('before',jsonb_build_object('status',case when e.detail->'before'->>'status' in ('draft','compared','decided','archived') then e.detail->'before'->'status' else null end),'after',jsonb_build_object('status',case when e.detail->'after'->>'status' in ('draft','compared','decided','archived') then e.detail->'after'->'status' else null end),'withheld','Raw historical references, comparison metrics and notes withheld from case-scoped audit projection') detail from public.simulation_scenario_events e join public.simulation_scenarios s on s.id=e.scenario_id and s.tenant_id=e.tenant_id where s.tenant_id=(select tenant_id from public.cases where id=_case_id) and s.evidence_refs @> jsonb_build_array(jsonb_build_object('kind','case','id',_case_id::text)) and ((e.detail->'after'->'baseline_metrics' is null or e.detail->'after'->'baseline_metrics'='null'::jsonb) or (e.detail->'after'->'baseline_metrics'->>'caseScopeVersion'='1' and e.detail->'after'->'baseline_metrics'->'caseIds'=jsonb_build_array(_case_id::text))) and ((e.detail->'before'->'baseline_metrics' is null or e.detail->'before'->'baseline_metrics'='null'::jsonb) or (e.detail->'before'->'baseline_metrics'->>'caseScopeVersion'='1' and e.detail->'before'->'baseline_metrics'->'caseIds'=jsonb_build_array(_case_id::text))) and (e.detail->'after'->'evidence_refs') @> jsonb_build_array(jsonb_build_object('kind','case','id',_case_id::text)) and not exists(select 1 from jsonb_array_elements(coalesce(e.detail->'after'->'evidence_refs','[]'::jsonb)) x where x->>'kind'='case' and x->>'id'<>_case_id::text) and (e.detail->'before' is null or e.detail->'before'='null'::jsonb or ((e.detail->'before'->'evidence_refs') @> jsonb_build_array(jsonb_build_object('kind','case','id',_case_id::text)) and not exists(select 1 from jsonb_array_elements(coalesce(e.detail->'before'->'evidence_refs','[]'::jsonb)) x where x->>'kind'='case' and x->>'id'<>_case_id::text)))) r),'[]'::jsonb),
  'simulationCaseComparison',jsonb_build_object(
    'caseId',_case_id::text,
    'basis','database-derived exact case links, not stored scenario metrics',
    'linkedEventIds',(select coalesce(jsonb_agg(distinct e.id order by e.id),'[]'::jsonb) from public.risk_events e join public.risk_event_case_links l on l.event_id=e.id and l.tenant_id=e.tenant_id where l.case_id=_case_id and l.tenant_id=(select tenant_id from public.cases where id=_case_id)),
    'recordedLinkedEvents',(select count(distinct e.id) from public.risk_events e join public.risk_event_case_links l on l.event_id=e.id and l.tenant_id=e.tenant_id where l.case_id=_case_id and l.tenant_id=(select tenant_id from public.cases where id=_case_id)),
    'confirmedLinkedEvents',(select count(distinct e.id) from public.risk_events e join public.risk_event_case_links l on l.event_id=e.id and l.tenant_id=e.tenant_id where l.case_id=_case_id and l.tenant_id=(select tenant_id from public.cases where id=_case_id) and e.verification_status='confirmed'),
    'scenarioImpact','insufficient_data',
    'limitation','Case-linked assumptions are operator assertions. No approved assumptions, causal exposure, time change or financial effect is established. Stored scenario metrics are not trusted source.'),
  'integratedFeaturesVersion','1',
  'countEngineVersion','1',
  'approvals','[]'::jsonb,
  'truthRule','Public and independent observations are corroboration unless the source directly proves the event. Inference remains inference until human review.'
 )
$$;

CREATE OR REPLACE FUNCTION public.persist_evidence_pack_atomic(_case_id uuid,_canonical text) RETURNS public.evidence_packs LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE c public.cases;p jsonb;v integer;pack public.evidence_packs;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated investigator required'; END IF;
 SELECT * INTO c FROM public.cases WHERE id=_case_id;
 IF c.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND tenant_id=c.tenant_id AND role IN('admin','investigator')) THEN RAISE EXCEPTION 'Investigator access required'; END IF;
 IF octet_length(_canonical)>20000000 THEN RAISE EXCEPTION 'Evidence pack payload too large'; END IF;
 p:=_canonical::jsonb;
 PERFORM pg_advisory_xact_lock(hashtextextended('case-evidence:'||_case_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('tenant-feature-evidence:'||c.tenant_id::text,0));
 SELECT coalesce(max(version),0)+1 INTO v FROM public.evidence_packs WHERE case_id=_case_id;
 IF (p->>'version')::integer IS DISTINCT FROM v THEN RAISE EXCEPTION 'Evidence pack version changed; reload and retry'; END IF;
 IF (p->>'generatedAt') IS NULL THEN RAISE EXCEPTION 'Pack generatedAt required'; END IF;
 PERFORM (p->>'generatedAt')::timestamptz;
 IF public.normalize_pack_source(p-'generatedAt'-'version') IS DISTINCT FROM public.normalize_pack_source(public.current_pack_source(_case_id)) THEN
  RAISE EXCEPTION 'Case evidence changed while preparing snapshot; reload and retry';
 END IF;
 -- Existing persistence trigger is the final role/clock/FLAGGED gate. No bypass.
 INSERT INTO public.evidence_packs(tenant_id,case_id,version,pack_payload,canonical_payload,sha256_hash,status)
 VALUES(c.tenant_id,_case_id,v,p,_canonical,encode(sha256(convert_to(_canonical,'UTF8')),'hex'),'DRAFT') RETURNING * INTO pack;
 UPDATE public.evidence_packs SET status='SUPERSEDED' WHERE case_id=_case_id AND id<>pack.id AND status='DRAFT';
 RETURN pack;
END $$;

-- Proposed equivalent direct-write validation, not a privilege revocation.
-- Row triggers already hold tuple locks on UPDATE. Never wait for an advisory
-- lock there: fail with SQLSTATE40001 so the entire transaction can retry.
create function public.guard_integrated_pack_write() returns trigger
language plpgsql security invoker set search_path='' as $$
declare expected_version integer; c public.cases;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('case-evidence:'||new.case_id::text,0)) then
    raise exception 'PACK_SOURCE_BUSY_RETRY_TRANSACTION' using errcode='40001';
  end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('tenant-feature-evidence:'||new.tenant_id::text,0)) then
    raise exception 'PACK_SOURCE_BUSY_RETRY_TRANSACTION' using errcode='40001';
  end if;
  if tg_op='INSERT' then
    if new.canonical_payload is null then raise exception 'NEW_PACK_CANONICAL_REQUIRED'; end if;
    if octet_length(new.canonical_payload)>20000000 then raise exception 'Evidence pack payload too large'; end if;
    if new.canonical_payload::jsonb is distinct from new.pack_payload or encode(sha256(convert_to(new.canonical_payload,'UTF8')),'hex') is distinct from new.sha256_hash then raise exception 'EVIDENCE_PACK_HASH_MISMATCH'; end if;
    select * into c from public.cases where id=new.case_id and tenant_id=new.tenant_id;
    if c.id is null then raise exception 'CASE_TENANT_MISMATCH'; end if;
    select coalesce(max(version),0)+1 into expected_version from public.evidence_packs where case_id=new.case_id;
    if new.version is distinct from expected_version or (new.pack_payload->>'version')::integer is distinct from expected_version then raise exception 'Evidence pack version changed; reload and retry'; end if;
    if new.pack_payload->>'generatedAt' is null then raise exception 'Pack generatedAt required'; end if;
    perform (new.pack_payload->>'generatedAt')::timestamptz;
    if public.normalize_pack_source(new.pack_payload-'generatedAt'-'version') is distinct from public.normalize_pack_source(public.current_pack_source(new.case_id)) then raise exception 'Case evidence changed while preparing snapshot; reload and retry'; end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_integrated_pack_write() from public;
create trigger a00_integrated_pack_write before insert or update on public.evidence_packs for each row execute function public.guard_integrated_pack_write();

-- PROPOSAL ONLY. One NEW read-only readiness function; apply nowhere without approval.
-- Reads catalog definitions only, no customer rows or changes. A mismatch fails closed.
-- Exact fingerprint covers eight tables, column/default/constraint definitions,
-- RLS policies/roles, enabled audit triggers and both feature function bodies.
-- PostgreSQL/version formatting differences intentionally refuse activation until reviewed.
create or replace function public.cargoiq_integrated_feature_readiness()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare fingerprint text;
begin
  if auth.uid() is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  if not exists (select 1 from public.user_roles r where r.user_id=auth.uid()) then raise exception 'MEMBERSHIP_REQUIRED'; end if;
  select md5(catalog::text) into fingerprint from (
select jsonb_build_object(
 'tables', (select jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity,'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'constraints',(select jsonb_agg(pg_catalog.pg_get_constraintdef(k.oid) order by k.conname) from pg_catalog.pg_constraint k where k.conrelid=c.oid),'policies',(select jsonb_agg(jsonb_build_object('name',p.polname,'cmd',p.polcmd,'roles',(select array_agg(r.rolname order by r.rolname) from pg_catalog.pg_roles r where r.oid=any(p.polroles)),'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid),'check',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_catalog.pg_policy p where p.polrelid=c.oid),'triggers',(select jsonb_agg(jsonb_build_object('definition',pg_catalog.pg_get_triggerdef(t.oid),'enabled',t.tgenabled) order by t.tgname) from pg_catalog.pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)) order by c.relname) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(ARRAY['cases','evidence_packs','risk_events','risk_event_case_links','risk_alerts','risk_alert_verifications','cost_recovery_links','simulation_scenarios','simulation_scenario_events','recovery_findings','recovery_finding_events','scene_assets','scene_asset_events','geospatial_findings','geospatial_finding_events'])),
 'functions',(select jsonb_agg(jsonb_build_object('definition',pg_catalog.pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.proname,p.oid::regprocedure::text) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like '%risk%' or p.proname like '%guard%' or p.proname like '%enforce%' or p.proname in ('normalize_pack_source','guard_pack_canonical','audit_pack_transition','approve_evidence_pack_atomic','lock_pack_source_case','enforce_operational_evidence_gate','enforce_core_write_role','enforce_evidence_tenant_consistency','guard_case_delete_with_packs','cargoiq_feature_atomic_audit','cargoiq_create_recovery_batch','lock_integrated_pack_source','current_pack_source','persist_evidence_pack_atomic')))
) as catalog
  ) expected_catalog;
  return jsonb_build_object('ready',fingerprint='026e8afa51cdf2b5e758f08ead4d8c7e','reason',case when fingerprint='026e8afa51cdf2b5e758f08ead4d8c7e' then 'Complete feature schema and audit definitions match expected release' else 'Feature schema or audit safeguards do not match verified release' end);
end;
$$;
revoke all on function public.cargoiq_integrated_feature_readiness() from public;
revoke all on function public.cargoiq_integrated_feature_readiness() from anon;
grant execute on function public.cargoiq_integrated_feature_readiness() to authenticated;

DO $$ declare fingerprint text; begin
select md5(catalog::text) into fingerprint from (
select jsonb_build_object(
 'tables', (select jsonb_agg(jsonb_build_object('name',c.relname,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity,'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'constraints',(select jsonb_agg(pg_catalog.pg_get_constraintdef(k.oid) order by k.conname) from pg_catalog.pg_constraint k where k.conrelid=c.oid),'policies',(select jsonb_agg(jsonb_build_object('name',p.polname,'cmd',p.polcmd,'roles',(select array_agg(r.rolname order by r.rolname) from pg_catalog.pg_roles r where r.oid=any(p.polroles)),'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid),'check',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_catalog.pg_policy p where p.polrelid=c.oid),'triggers',(select jsonb_agg(jsonb_build_object('definition',pg_catalog.pg_get_triggerdef(t.oid),'enabled',t.tgenabled) order by t.tgname) from pg_catalog.pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)) order by c.relname) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(ARRAY['cases','evidence_packs','risk_events','risk_event_case_links','risk_alerts','risk_alert_verifications','cost_recovery_links','simulation_scenarios','simulation_scenario_events','recovery_findings','recovery_finding_events','scene_assets','scene_asset_events','geospatial_findings','geospatial_finding_events'])),
 'functions',(select jsonb_agg(jsonb_build_object('definition',pg_catalog.pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.proname,p.oid::regprocedure::text) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like '%risk%' or p.proname like '%guard%' or p.proname like '%enforce%' or p.proname in ('normalize_pack_source','guard_pack_canonical','audit_pack_transition','approve_evidence_pack_atomic','lock_pack_source_case','enforce_operational_evidence_gate','enforce_core_write_role','enforce_evidence_tenant_consistency','guard_case_delete_with_packs','cargoiq_feature_atomic_audit','cargoiq_create_recovery_batch','lock_integrated_pack_source','current_pack_source','persist_evidence_pack_atomic')))
) as catalog
  ) expected_catalog;

if fingerprint <> '026e8afa51cdf2b5e758f08ead4d8c7e' then raise exception 'FINAL_FEATURE_READINESS_MISMATCH'; end if; end $$;
COMMIT;
