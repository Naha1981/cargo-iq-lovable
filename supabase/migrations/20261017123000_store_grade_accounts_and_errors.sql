-- CargoIQ store-grade follow-up, 2026-10-17
-- Paste-safe for the Lovable Cloud SQL editor. Idempotent.
-- 1) app_errors: client-side error log (insert-only for users; not readable via API)
-- 2) delete_own_account(): lets a signed-in user delete their own account and,
--    when they are the only member, the whole workspace and its data.

create table if not exists public.app_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  route text,
  source text,
  message text,
  stack text,
  created_at timestamptz not null default now()
);

alter table public.app_errors enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'app_errors' and policyname = 'app_errors_insert_authenticated'
  ) then
    create policy app_errors_insert_authenticated on public.app_errors
      for insert to authenticated with check (true);
  end if;
end $$;

-- No select/update/delete policies: clients can write errors but never read them.

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  tid uuid;
  other_members int;
begin
  if uid is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  select tenant_id into tid
  from public.user_roles
  where user_id = uid
  order by created_at asc
  limit 1;

  if tid is not null then
    select count(*) into other_members
    from public.user_roles
    where tenant_id = tid and user_id <> uid;

    if other_members = 0 then
      -- Sole member: remove the whole workspace, children first.
      delete from public.timeline_events where tenant_id = tid;
      delete from public.contradictions where tenant_id = tid;
      delete from public.extracted_claims where tenant_id = tid;
      delete from public.documents where tenant_id = tid;
      delete from public.evidence_packs where tenant_id = tid;
      delete from public.financial_calculations where tenant_id = tid;
      delete from public.commercial_rules where tenant_id = tid;
      delete from public.external_observations where tenant_id = tid;
      delete from public.operational_definitions where tenant_id = tid;
      delete from public.operational_clocks where tenant_id = tid;
      delete from public.clock_reconciliations where tenant_id = tid;
      delete from public.appointment_attributions where tenant_id = tid;
      delete from public.appointment_lifecycle where tenant_id = tid;
      delete from public.kpi_definitions where tenant_id = tid;
      delete from public.cross_party_match_reviews where tenant_id = tid;
      delete from public.cross_party_matches where tenant_id = tid;
      delete from public.evidence_gap_entries where tenant_id = tid;
      delete from public.authorised_imports where tenant_id = tid;
      delete from public.count_comparison_definitions where tenant_id = tid;
      delete from public.count_rule_versions where tenant_id = tid;
      delete from public.count_source_records where tenant_id = tid;
      delete from public.cctv_observations where tenant_id = tid;
      delete from public.cctv_evidence_artifacts where tenant_id = tid;
      delete from public.cctv_ingest_nonces where tenant_id = tid;
      delete from public.cctv_cameras where tenant_id = tid;
      delete from public.cctv_sources where tenant_id = tid;
      delete from public.cctv_zones where tenant_id = tid;
      delete from public.audit_log where tenant_id = tid;
      delete from public.cases where tenant_id = tid;
      delete from public.user_roles where tenant_id = tid;
      delete from public.tenants where id = tid;
    else
      -- Shared workspace: leave the data, detach this user only.
      delete from public.user_roles where tenant_id = tid and user_id = uid;
    end if;
  end if;

  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;
