create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('admin', 'investigator', 'auditor');
exception when duplicate_object then null;
end $$;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  constraint organizations_tenant_is_id check (tenant_id = id)
);

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'investigator',
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, tenant_id)
);

create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  reference_no text not null,
  vessel_name text,
  voyage_no text,
  container_no text,
  port_code text,
  status text not null default 'INVESTIGATING' check (status in ('INVESTIGATING','IN_REVIEW','APPROVED','RECOVERY','CLOSED')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  name text not null,
  file_path text not null,
  file_type text not null,
  sha256_hash text not null,
  source_party text,
  evidence_class text not null default 'CUSTOMER_PRIMARY',
  uploaded_at timestamptz not null default now()
);

create table if not exists public.extracted_claims (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  page_number integer,
  claim_text text not null,
  claim_type text,
  normalized_value jsonb,
  evidence_class text not null default 'CUSTOMER_PRIMARY',
  nature text not null check (nature in ('OBSERVED','REPORTED','DERIVED','INFERRED','DISPUTED')),
  status text not null default 'PENDING' check (status in ('PENDING','VERIFIED','DISPUTED')),
  confidence numeric(5,4),
  timestamp_claimed timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.contradictions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  title text not null,
  description text not null,
  claim_a_id uuid references public.extracted_claims(id) on delete cascade,
  claim_b_id uuid references public.extracted_claims(id) on delete cascade,
  financial_impact numeric,
  status text not null default 'FLAGGED' check (status in ('FLAGGED','RESOLVED')),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.timeline_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  "timestamp" timestamptz not null,
  title text not null,
  source text not null,
  evidence_class text not null default 'DERIVED',
  nature text not null check (nature in ('OBSERVED','REPORTED','DERIVED','INFERRED','DISPUTED')),
  coordinates jsonb,
  provenance_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.external_observations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  source text not null,
  observation_type text not null,
  observed_at timestamptz,
  latitude numeric,
  longitude numeric,
  payload jsonb not null default '{}'::jsonb,
  confidence numeric(5,4),
  limitation text,
  created_at timestamptz not null default now()
);

create table if not exists public.commercial_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  rule_version text not null,
  rule_type text not null,
  currency text,
  payload jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(tenant_id, name, rule_version)
);

create table if not exists public.financial_calculations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  calculation_type text not null,
  rule_version text not null,
  input_payload jsonb not null,
  result_payload jsonb not null,
  calculated_amount_minor bigint,
  charged_amount_minor bigint,
  variance_minor bigint,
  currency text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.evidence_packs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  version integer not null,
  pack_payload jsonb not null,
  sha256_hash text not null,
  approved_by uuid references auth.users(id),
  status text not null default 'DRAFT' check (status in ('DRAFT','APPROVED','SUPERSEDED')),
  generated_at timestamptz not null default now(),
  unique(tenant_id, case_id, version)
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizations(id) on delete cascade,
  case_id uuid references public.cases(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  action text not null,
  entity_type text,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.current_tenant_id()
returns uuid language sql stable security definer set search_path = public as $$
  select ur.tenant_id from public.user_roles ur
  where ur.user_id = auth.uid()
  order by ur.created_at asc limit 1
$$;

create or replace function public.is_tenant_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.user_roles where user_id = auth.uid() and tenant_id = public.current_tenant_id() and role = 'admin')
$$;

create or replace function public.provision_organization(org_name text default null)
returns uuid
language plpgsql security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  existing_tenant uuid;
  new_tenant uuid := gen_random_uuid();
  base_slug text;
  final_slug text;
begin
  if uid is null then raise exception 'UNAUTHENTICATED'; end if;
  select tenant_id into existing_tenant from public.user_roles where user_id = uid order by created_at asc limit 1;
  if existing_tenant is not null then return existing_tenant; end if;

  base_slug := lower(regexp_replace(coalesce(nullif(trim(org_name), ''), 'cargoiq-' || left(uid::text, 8)), '[^a-zA-Z0-9]+', '-', 'g'));
  final_slug := trim(both '-' from base_slug);
  if final_slug = '' then final_slug := 'cargoiq-' || left(uid::text, 8); end if;

  while exists(select 1 from public.organizations where slug = final_slug) loop
    final_slug := left(final_slug, 42) || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
  end loop;

  insert into public.organizations(id, tenant_id, name, slug)
  values(new_tenant, new_tenant, coalesce(nullif(trim(org_name), ''), 'CargoIQ Workspace'), final_slug);
  insert into public.user_roles(user_id, role, tenant_id) values(uid, 'admin', new_tenant);
  return new_tenant;
end $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public, auth as $$
begin
  perform public.provision_organization(coalesce(new.raw_user_meta_data->>'organization_name', split_part(coalesce(new.email, 'user'), '@', 1) || ' Workspace'));
  return new;
end $$;

drop trigger if exists on_auth_user_created_cargoiq on auth.users;
create trigger on_auth_user_created_cargoiq after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists cases_updated_at on public.cases;
create trigger cases_updated_at before update on public.cases for each row execute function public.set_updated_at();

drop trigger if exists claims_updated_at on public.extracted_claims;
create trigger claims_updated_at before update on public.extracted_claims for each row execute function public.set_updated_at();

alter table public.organizations enable row level security;
alter table public.user_roles enable row level security;
alter table public.cases enable row level security;
alter table public.documents enable row level security;
alter table public.extracted_claims enable row level security;
alter table public.contradictions enable row level security;
alter table public.timeline_events enable row level security;
alter table public.external_observations enable row level security;
alter table public.commercial_rules enable row level security;
alter table public.financial_calculations enable row level security;
alter table public.evidence_packs enable row level security;
alter table public.audit_log enable row level security;

create policy organizations_select on public.organizations for select to authenticated using (tenant_id = public.current_tenant_id());
create policy organizations_update on public.organizations for update to authenticated using (tenant_id = public.current_tenant_id() and public.is_tenant_admin()) with check (tenant_id = public.current_tenant_id());
create policy organizations_delete on public.organizations for delete to authenticated using (tenant_id = public.current_tenant_id() and public.is_tenant_admin());

create policy user_roles_select on public.user_roles for select to authenticated using (tenant_id = public.current_tenant_id());
create policy user_roles_insert on public.user_roles for insert to authenticated with check (tenant_id = public.current_tenant_id() and (user_id = auth.uid() or public.is_tenant_admin()));
create policy user_roles_update on public.user_roles for update to authenticated using (tenant_id = public.current_tenant_id() and public.is_tenant_admin()) with check (tenant_id = public.current_tenant_id());
create policy user_roles_delete on public.user_roles for delete to authenticated using (tenant_id = public.current_tenant_id() and public.is_tenant_admin());

do $$
declare t text;
begin
  foreach t in array array['cases','documents','extracted_claims','contradictions','timeline_events','external_observations','commercial_rules','financial_calculations','evidence_packs','audit_log'] loop
    execute format('create policy %I_select on public.%I for select to authenticated using (tenant_id = public.current_tenant_id())', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (tenant_id = public.current_tenant_id())', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id())', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (tenant_id = public.current_tenant_id())', t, t);
  end loop;
end $$;

grant usage on type public.app_role to authenticated, service_role;
grant select, insert, update, delete on public.organizations, public.user_roles, public.cases, public.documents, public.extracted_claims, public.contradictions, public.timeline_events, public.external_observations, public.commercial_rules, public.financial_calculations, public.evidence_packs, public.audit_log to authenticated;
grant all on public.organizations, public.user_roles, public.cases, public.documents, public.extracted_claims, public.contradictions, public.timeline_events, public.external_observations, public.commercial_rules, public.financial_calculations, public.evidence_packs, public.audit_log to service_role;
grant execute on function public.current_tenant_id() to authenticated, service_role;
grant execute on function public.is_tenant_admin() to authenticated, service_role;
grant execute on function public.provision_organization(text) to authenticated, service_role;

insert into storage.buckets(id, name, public) values('case-documents','case-documents',false) on conflict(id) do nothing;

drop policy if exists case_documents_storage_select on storage.objects;
create policy case_documents_storage_select on storage.objects for select to authenticated using(bucket_id='case-documents' and (storage.foldername(name))[1] = public.current_tenant_id()::text);

drop policy if exists case_documents_storage_insert on storage.objects;
create policy case_documents_storage_insert on storage.objects for insert to authenticated with check(bucket_id='case-documents' and (storage.foldername(name))[1] = public.current_tenant_id()::text);

drop policy if exists case_documents_storage_update on storage.objects;
create policy case_documents_storage_update on storage.objects for update to authenticated using(bucket_id='case-documents' and (storage.foldername(name))[1] = public.current_tenant_id()::text) with check(bucket_id='case-documents' and (storage.foldername(name))[1] = public.current_tenant_id()::text);

drop policy if exists case_documents_storage_delete on storage.objects;
create policy case_documents_storage_delete on storage.objects for delete to authenticated using(bucket_id='case-documents' and (storage.foldername(name))[1] = public.current_tenant_id()::text);
