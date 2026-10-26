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
 'tables', (select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'constraints',(select jsonb_agg(pg_catalog.pg_get_constraintdef(k.oid) order by k.conname) from pg_catalog.pg_constraint k where k.conrelid=c.oid),'policies',(select jsonb_agg(jsonb_build_object('name',p.polname,'cmd',p.polcmd,'roles',(select array_agg(r.rolname order by r.rolname) from pg_catalog.pg_roles r where r.oid=any(p.polroles)),'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid),'check',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_catalog.pg_policy p where p.polrelid=c.oid),'triggers',(select jsonb_agg(jsonb_build_object('definition',pg_catalog.pg_get_triggerdef(t.oid),'enabled',t.tgenabled) order by t.tgname) from pg_catalog.pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal)) order by c.relname) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(ARRAY['simulation_scenarios','simulation_scenario_events','recovery_findings','recovery_finding_events','scene_assets','scene_asset_events','geospatial_findings','geospatial_finding_events'])),
 'functions',(select jsonb_agg(pg_catalog.pg_get_functiondef(p.oid) order by p.proname) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('cargoiq_feature_atomic_audit','cargoiq_create_recovery_batch'))
) as catalog
  ) expected_catalog;
  return jsonb_build_object('ready',fingerprint='1051f064af0ec88d1389a41ab22b2df5','reason',case when fingerprint='1051f064af0ec88d1389a41ab22b2df5' then 'Complete feature schema and audit definitions match expected release' else 'Feature schema or audit safeguards do not match verified release' end);
end;
$$;
revoke all on function public.cargoiq_integrated_feature_readiness() from public;
revoke all on function public.cargoiq_integrated_feature_readiness() from anon;
grant execute on function public.cargoiq_integrated_feature_readiness() to authenticated;
