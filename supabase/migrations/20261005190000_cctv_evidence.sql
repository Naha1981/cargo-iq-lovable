-- CargoIQ CCTV computer-vision evidence
-- Edge CV remains outside CargoIQ; this migration stores normalized provenance,
-- immutable evidence metadata and tenant-scoped review state.

create table if not exists public.cctv_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  site_location text,
  provider text not null default 'Lot Vulture',
  provider_version text,
  deployment_type text not null default 'edge',
  license_status text not null default 'REVIEW',
  retention_days integer not null default 30 check (retention_days between 1 and 3650),
  privacy_notes text,
  ingest_secret_ciphertext text not null,
  enabled boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cctv_sources_tenant_idx on public.cctv_sources(tenant_id);

create table if not exists public.cctv_cameras (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  source_id uuid not null references public.cctv_sources(id) on delete cascade,
  provider_camera_id text not null,
  display_name text not null,
  manufacturer text,
  stream_type text,
  installation_location text,
  latitude double precision,
  longitude double precision,
  timezone text not null default 'UTC',
  health_status text not null default 'UNKNOWN',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, provider_camera_id)
);

create index if not exists cctv_cameras_tenant_idx on public.cctv_cameras(tenant_id);
create index if not exists cctv_cameras_source_idx on public.cctv_cameras(source_id);

create table if not exists public.cctv_zones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  camera_id uuid not null references public.cctv_cameras(id) on delete cascade,
  provider_zone_id text,
  zone_code text not null,
  zone_type text not null default 'CUSTOM',
  semantic_purpose text,
  polygon jsonb,
  created_at timestamptz not null default now(),
  unique (camera_id, zone_code)
);

create index if not exists cctv_zones_tenant_idx on public.cctv_zones(tenant_id);
create index if not exists cctv_zones_camera_idx on public.cctv_zones(camera_id);

create table if not exists public.cctv_observations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  source_id uuid not null references public.cctv_sources(id) on delete restrict,
  camera_id uuid references public.cctv_cameras(id) on delete set null,
  zone_id uuid references public.cctv_zones(id) on delete set null,
  case_id uuid references public.cases(id) on delete set null,
  provider_event_id text,
  idempotency_key text not null,
  event_type text not null,
  detected_class text,
  observed_at timestamptz not null,
  source_observed_at timestamptz,
  processed_at timestamptz,
  received_at timestamptz not null default now(),
  timezone text,
  confidence numeric(6,5),
  model_name text,
  model_version text,
  processing_version text,
  roi jsonb,
  payload jsonb not null default '{}'::jsonb,
  evidence_available boolean not null default false,
  review_status text not null default 'PENDING',
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  external_observation_id uuid,
  timeline_event_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);

create index if not exists cctv_observations_tenant_case_idx on public.cctv_observations(tenant_id, case_id);
create index if not exists cctv_observations_time_idx on public.cctv_observations(tenant_id, observed_at);
create index if not exists cctv_observations_source_idx on public.cctv_observations(source_id);

create table if not exists public.cctv_evidence_artifacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  observation_id uuid not null references public.cctv_observations(id) on delete cascade,
  source_id uuid not null references public.cctv_sources(id) on delete restrict,
  camera_id uuid references public.cctv_cameras(id) on delete set null,
  storage_path text not null,
  media_type text not null,
  file_name text,
  byte_size bigint not null,
  sha256_hash text not null,
  captured_at timestamptz,
  source_timestamp timestamptz,
  retrieved_at timestamptz not null default now(),
  model_name text,
  model_version text,
  processing_version text,
  immutable boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists cctv_evidence_tenant_obs_idx on public.cctv_evidence_artifacts(tenant_id, observation_id);
create index if not exists cctv_evidence_sha_idx on public.cctv_evidence_artifacts(sha256_hash);

create table if not exists public.cctv_ingest_nonces (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.cctv_sources(id) on delete cascade,
  nonce text not null,
  observed_at timestamptz not null default now(),
  unique (source_id, nonce)
);

create index if not exists cctv_ingest_nonces_time_idx on public.cctv_ingest_nonces(observed_at);

insert into storage.buckets (id, name, public)
values ('cctv-evidence', 'cctv-evidence', false)
on conflict (id) do nothing;

create or replace function public.cargoiq_cctv_tenant_ids()
returns setof uuid
language sql
security definer
set search_path = public
as $$
  select tenant_id
  from public.user_roles
  where user_id = auth.uid();
$$;

revoke all on function public.cargoiq_cctv_tenant_ids() from public;
grant execute on function public.cargoiq_cctv_tenant_ids() to authenticated;

alter table public.cctv_sources enable row level security;
alter table public.cctv_cameras enable row level security;
alter table public.cctv_zones enable row level security;
alter table public.cctv_observations enable row level security;
alter table public.cctv_evidence_artifacts enable row level security;
alter table public.cctv_ingest_nonces enable row level security;

drop policy if exists cctv_sources_tenant_select on public.cctv_sources;
create policy cctv_sources_tenant_select on public.cctv_sources
for select to authenticated
using (tenant_id in (select public.cargoiq_cctv_tenant_ids()));

drop policy if exists cctv_sources_tenant_modify on public.cctv_sources;
create policy cctv_sources_tenant_modify on public.cctv_sources
for all to authenticated
using (tenant_id in (select public.cargoiq_cctv_tenant_ids()))
with check (tenant_id in (select public.cargoiq_cctv_tenant_ids()));

drop policy if exists cctv_cameras_tenant_select on public.cctv_cameras;
create policy cctv_cameras_tenant_select on public.cctv_cameras
for select to authenticated
using (tenant_id in (select public.cargoiq_cctv_tenant_ids()));

drop policy if exists cctv_cameras_tenant_modify on public.cctv_cameras;
create policy cctv_cameras_tenant_modify on public.cctv_cameras
for all to authenticated
using (tenant_id in (select public.cargoiq_cctv_tenant_ids()))
with check (tenant_id in (select public.cargoiq_cctv_tenant_ids()));

drop policy if exists cctv_zones_tenant_select on public.cctv_zones;
create policy cctv_zones_tenant_select on public.cctv_zones
for select to authenticated
using (tenant_id in (select public.cargoiq_cctv_tenant_ids()));

drop policy if exists cctv_zones_tenant_modify on public.cctv_zones;
create policy cctv_zones_tenant_modify on public.cctv_zones
for all to authenticated
using (tenant_id in (select public.cargoiq_cctv_tenant_ids()))
with check (tenant_id in (select public.cargoiq_cctv_tenant_ids()));

drop policy if exists cctv_observations_tenant_select on public.cctv_observations;
create policy cctv_observations_tenant_select on public.cctv_observations
for select to authenticated
using (tenant_id in (select public.cargoiq_cctv_tenant_ids()));

drop policy if exists cctv_observations_tenant_modify on public.cctv_observations;
create policy cctv_observations_tenant_modify on public.cctv_observations
for all to authenticated
using (tenant_id in (select public.cargoiq_cctv_tenant_ids()))
with check (tenant_id in (select public.cargoiq_cctv_tenant_ids()));

drop policy if exists cctv_evidence_tenant_select on public.cctv_evidence_artifacts;
create policy cctv_evidence_tenant_select on public.cctv_evidence_artifacts
for select to authenticated
using (tenant_id in (select public.cargoiq_cctv_tenant_ids()));

drop policy if exists cctv_evidence_tenant_modify on public.cctv_evidence_artifacts;
create policy cctv_evidence_tenant_modify on public.cctv_evidence_artifacts
for all to authenticated
using (tenant_id in (select public.cargoiq_cctv_tenant_ids()))
with check (tenant_id in (select public.cargoiq_cctv_tenant_ids()));

drop policy if exists cctv_nonces_tenant_select on public.cctv_ingest_nonces;
create policy cctv_nonces_tenant_select on public.cctv_ingest_nonces
for select to authenticated
using (
  exists (
    select 1 from public.cctv_sources s
    where s.id = source_id
      and s.tenant_id in (select public.cargoiq_cctv_tenant_ids())
  )
);
