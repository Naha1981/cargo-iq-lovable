-- PROPOSAL ONLY. NOT covered by the unanswered eight-table-only question.
-- Scope: one NEW function, four triggers on NEW feature tables, four policy
-- removals on NEW audit tables. No existing pre-feature objects are altered.
-- Deploy only together with the corresponding server-function changes.
create function public.cargoiq_feature_atomic_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  event_table text;
  parent_column text;
  event_action text;
  previous jsonb := null;
  current_row jsonb := to_jsonb(new);
  from_status text;
  to_status text;
begin
  if actor_id is null or not exists (
    select 1 from public.user_roles r where r.tenant_id = new.tenant_id
      and r.user_id = actor_id and r.role in ('admin','investigator')
  ) then raise exception 'FEATURE_WRITE_REQUIRES_INVESTIGATOR'; end if;
  if tg_op = 'UPDATE' then
    previous := to_jsonb(old);
    if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
       or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
    then raise exception 'IMMUTABLE_FEATURE_IDENTITY'; end if;
  else
    if new.created_by is distinct from actor_id then raise exception 'CREATOR_MUST_MATCH_ACTOR'; end if;
  end if;
  case tg_table_name
    when 'recovery_findings' then
      event_table := 'recovery_finding_events'; parent_column := 'finding_id';
      to_status := new.status;
      if tg_op='UPDATE' and (
        new.calculation->>'request_id' is distinct from old.calculation->>'request_id' or
        new.calculation->>'request_fingerprint' is distinct from old.calculation->>'request_fingerprint')
      then raise exception 'IMMUTABLE_COMPARISON_REQUEST'; end if;
      if tg_op = 'INSERT' and to_status <> 'new' then raise exception 'INITIAL_RECOVERY_STATUS_REQUIRED'; end if;
      if tg_op = 'UPDATE' and old.status <> new.status then
        from_status := old.status;
        if not ((from_status='new' and to_status in ('under_review','rejected'))
          or (from_status='under_review' and to_status in ('approved','rejected'))
          or (from_status='approved' and to_status in ('submitted','rejected'))
          or (from_status='submitted' and to_status in ('recovered','rejected')))
        then raise exception 'INVALID_RECOVERY_TRANSITION'; end if;
      end if;
      if to_status = 'recovered' and (
        new.calculation #>> '{recoveredConfirmation,confirmed}' is distinct from 'true'
        or new.calculation #>> '{recoveredConfirmation,actor}' is distinct from actor_id::text
      ) then raise exception 'RECOVERY_CONFIRMATION_REQUIRED'; end if;
      event_action := case when tg_op='INSERT' then 'finding_created'
        when old.status <> new.status then 'status_changed'
        when old.assigned_to is distinct from new.assigned_to then 'assignee_changed' else 'updated' end;
    when 'simulation_scenarios' then
      event_table := 'simulation_scenario_events'; parent_column := 'scenario_id';
      event_action := case when tg_op='INSERT' then 'created'
        when new.status='compared' then 'compared'
        when new.status='decided' then 'decision_recorded'
        when new.status='archived' then 'archived' else 'updated' end;
      if tg_op='INSERT' and new.status <> 'draft' then raise exception 'INITIAL_SCENARIO_STATUS_REQUIRED'; end if;
      if tg_op='UPDATE' and old.status = 'archived' then raise exception 'ARCHIVED_SCENARIO_READ_ONLY'; end if;
    when 'scene_assets' then
      event_table := 'scene_asset_events'; parent_column := 'asset_id';
      if exists (select 1 from jsonb_array_elements_text(coalesce(new.provenance->'caseEventIds','[]'::jsonb)) x(id)
        where not exists (select 1 from public.timeline_events e where e.id::text=x.id and e.tenant_id=new.tenant_id and e.case_id=new.case_id))
      or exists (select 1 from jsonb_array_elements_text(coalesce(new.provenance->'documentIds','[]'::jsonb)) x(id)
        where not exists (select 1 from public.documents d where d.id::text=x.id and d.tenant_id=new.tenant_id and d.case_id=new.case_id))
      then raise exception 'SCENE_LINK_NOT_IN_CASE'; end if;
      event_action := case when tg_op='INSERT' then 'asset_registered' else 'updated' end;
      if new.status='ready' and nullif(trim(new.tileset_url),'') is null
      then raise exception 'READY_REQUIRES_TILESET'; end if;
    when 'geospatial_findings' then
      event_table := 'geospatial_finding_events'; parent_column := 'finding_id';
      event_action := case when tg_op='INSERT' then 'finding_created' else 'review_changed' end;
      if tg_op='UPDATE' and old.review_status <> new.review_status and not (
        (old.review_status='draft' and new.review_status in ('under_review','rejected')) or
        (old.review_status='under_review' and new.review_status in ('confirmed','rejected')) or
        (old.review_status='rejected' and new.review_status='under_review'))
      then raise exception 'INVALID_REVIEW_TRANSITION'; end if;
      if new.review_status = 'confirmed' and nullif(trim(new.rationale),'') is null
      then raise exception 'CONFIRM_REQUIRES_RATIONALE'; end if;
      if tg_op='INSERT' and new.review_status not in ('draft','under_review')
      then raise exception 'INITIAL_FINDING_STATUS_REQUIRED'; end if;
    else raise exception 'UNSUPPORTED_FEATURE_TABLE';
  end case;
  execute format('insert into public.%I (tenant_id,%I,action,actor,detail) values ($1,$2,$3,$4,$5)', event_table,parent_column)
    using new.tenant_id,new.id,event_action,actor_id,
      jsonb_build_object('before',previous,'after',current_row,'origin','database_trigger');
  return new;
end;
$$;
revoke all on function public.cargoiq_feature_atomic_audit() from public;
create trigger recovery_atomic_audit after insert or update on public.recovery_findings
for each row execute function public.cargoiq_feature_atomic_audit();
create trigger scenario_atomic_audit after insert or update on public.simulation_scenarios
for each row execute function public.cargoiq_feature_atomic_audit();
create trigger scene_atomic_audit after insert or update on public.scene_assets
for each row execute function public.cargoiq_feature_atomic_audit();
create trigger geospatial_atomic_audit after insert or update on public.geospatial_findings
for each row execute function public.cargoiq_feature_atomic_audit();
-- Client-written audit rows are replaced by transaction-bound trigger writes.
drop policy recovery_finding_events_insert on public.recovery_finding_events;
drop policy simulation_scenario_events_insert on public.simulation_scenario_events;
drop policy scene_asset_events_insert on public.scene_asset_events;
drop policy geospatial_finding_events_insert on public.geospatial_finding_events;
