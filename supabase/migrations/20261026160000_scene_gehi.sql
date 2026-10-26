-- 3D Scene assets + Geospatial Evidence & Historical Intelligence (GEHI).
-- PREPARED ONLY: requires separate explicit staging DDL approval before apply.
create table if not exists public.scene_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  case_id uuid references public.cases(id),
  name text not null,
  source_type text not null check (source_type in ('ply','3dtiles','laz','other')),
  status text not null default 'registered' check (status in ('registered','queued','converting','ready','failed')),
  source_ref text,
  acquired_at timestamptz,
  tileset_url text,
  provenance jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.scene_asset_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  asset_id uuid not null references public.scene_assets(id) on delete cascade,
  action text not null,
  actor uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.geospatial_findings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  case_id uuid references public.cases(id),
  title text not null,
  summary text,
  latitude double precision,
  longitude double precision,
  event_time timestamptz,
  observation_time timestamptz,
  source text not null,
  method text not null,
  confidence text not null default 'unverified' check (confidence in ('verified','high','medium','low','unverified')),
  rationale text,
  alternatives text,
  limitations text,
  review_status text not null default 'draft' check (review_status in ('draft','under_review','confirmed','rejected')),
  next_action text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.geospatial_finding_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  finding_id uuid not null references public.geospatial_findings(id) on delete cascade,
  action text not null,
  actor uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.scene_assets enable row level security;
alter table public.scene_asset_events enable row level security;
alter table public.geospatial_findings enable row level security;
alter table public.geospatial_finding_events enable row level security;




create index if not exists scene_assets_case_idx on public.scene_assets(case_id);
create index if not exists geospatial_findings_case_idx on public.geospatial_findings(case_id);

-- Hardened permissions: readers may read; only workspace investigators/admins write.
-- Audit records are append-only for authenticated clients, never update/delete.
create policy scene_assets_read on public.scene_assets for select to authenticated using (exists (select 1 from public.user_roles r where r.tenant_id = scene_assets.tenant_id and r.user_id = auth.uid()));
create policy scene_assets_insert on public.scene_assets for insert to authenticated with check (exists (select 1 from public.user_roles r where r.tenant_id = scene_assets.tenant_id and r.user_id = auth.uid() and r.role in ('admin','investigator')) and (case_id is null or exists (select 1 from public.cases c where c.id = scene_assets.case_id and c.tenant_id = scene_assets.tenant_id)));
create policy scene_assets_update on public.scene_assets for update to authenticated using (exists (select 1 from public.user_roles r where r.tenant_id = scene_assets.tenant_id and r.user_id = auth.uid() and r.role in ('admin','investigator'))) with check (exists (select 1 from public.user_roles r where r.tenant_id = scene_assets.tenant_id and r.user_id = auth.uid() and r.role in ('admin','investigator')) and (case_id is null or exists (select 1 from public.cases c where c.id = scene_assets.case_id and c.tenant_id = scene_assets.tenant_id)));
create policy scene_asset_events_read on public.scene_asset_events for select to authenticated using (exists (select 1 from public.user_roles r where r.tenant_id = scene_asset_events.tenant_id and r.user_id = auth.uid()));
create policy scene_asset_events_insert on public.scene_asset_events for insert to authenticated with check (exists (select 1 from public.user_roles r where r.tenant_id = scene_asset_events.tenant_id and r.user_id = auth.uid() and r.role in ('admin','investigator')) and actor = auth.uid() and exists (select 1 from public.scene_assets p where p.id = scene_asset_events.asset_id and p.tenant_id = scene_asset_events.tenant_id));
create policy geospatial_findings_read on public.geospatial_findings for select to authenticated using (exists (select 1 from public.user_roles r where r.tenant_id = geospatial_findings.tenant_id and r.user_id = auth.uid()));
create policy geospatial_findings_insert on public.geospatial_findings for insert to authenticated with check (exists (select 1 from public.user_roles r where r.tenant_id = geospatial_findings.tenant_id and r.user_id = auth.uid() and r.role in ('admin','investigator')) and (case_id is null or exists (select 1 from public.cases c where c.id = geospatial_findings.case_id and c.tenant_id = geospatial_findings.tenant_id)));
create policy geospatial_findings_update on public.geospatial_findings for update to authenticated using (exists (select 1 from public.user_roles r where r.tenant_id = geospatial_findings.tenant_id and r.user_id = auth.uid() and r.role in ('admin','investigator'))) with check (exists (select 1 from public.user_roles r where r.tenant_id = geospatial_findings.tenant_id and r.user_id = auth.uid() and r.role in ('admin','investigator')) and (case_id is null or exists (select 1 from public.cases c where c.id = geospatial_findings.case_id and c.tenant_id = geospatial_findings.tenant_id)));
create policy geospatial_finding_events_read on public.geospatial_finding_events for select to authenticated using (exists (select 1 from public.user_roles r where r.tenant_id = geospatial_finding_events.tenant_id and r.user_id = auth.uid()));
create policy geospatial_finding_events_insert on public.geospatial_finding_events for insert to authenticated with check (exists (select 1 from public.user_roles r where r.tenant_id = geospatial_finding_events.tenant_id and r.user_id = auth.uid() and r.role in ('admin','investigator')) and actor = auth.uid() and exists (select 1 from public.geospatial_findings p where p.id = geospatial_finding_events.finding_id and p.tenant_id = geospatial_finding_events.tenant_id));
