-- CargoIQ Logistics Risk Intelligence
-- Early-warning layer on top of the shipment evidence workspace:
-- normalized external events, case correlation, risk alerts with
-- confidence/impact/recommended action, human verification decisions,
-- cost-recovery links, and tenant-configurable sources (config, not code).
-- Every event keeps source reference, observed/ingested timestamps,
-- confidence and verification status so alerts trace back to evidence.
-- AIS gaps and predictions stay risk signals, never confirmed facts:
-- verification_status only moves to 'confirmed' through a human decision
-- recorded in public.risk_alert_verifications.

create table if not exists public.risk_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  source text not null,
  kind text not null check (kind in ('weather','vessel','port_notice','satellite','flight','incident','other')),
  title text not null,
  summary text,
  observed_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  latitude double precision,
  longitude double precision,
  port_code text,
  corridor text,
  vessel_name text,
  confidence text not null default 'low' check (confidence in ('low','medium','high')),
  verification_status text not null default 'unverified' check (verification_status in ('unverified','suspected','confirmed','rejected')),
  source_ref text,
  dedupe_key text not null,
  raw jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, dedupe_key)
);

create index if not exists risk_events_tenant_observed_idx on public.risk_events(tenant_id, observed_at desc);
create index if not exists risk_events_tenant_port_idx on public.risk_events(tenant_id, port_code);
create index if not exists risk_events_tenant_vessel_idx on public.risk_events(tenant_id, vessel_name);

create table if not exists public.risk_event_case_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  event_id uuid not null references public.risk_events(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  match_basis text not null check (match_basis in ('port','vessel','corridor','manual')),
  rationale text not null,
  confidence text not null default 'low' check (confidence in ('low','medium','high')),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (event_id, case_id, match_basis)
);

create index if not exists risk_event_case_links_tenant_case_idx on public.risk_event_case_links(tenant_id, case_id);
create index if not exists risk_event_case_links_event_idx on public.risk_event_case_links(event_id);

create table if not exists public.risk_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  event_id uuid not null references public.risk_events(id) on delete cascade,
  case_id uuid references public.cases(id) on delete cascade,
  severity text not null default 'info' check (severity in ('info','watch','warning','critical')),
  headline text not null,
  risk_explanation text not null,
  evidence_summary text not null,
  confidence text not null default 'low' check (confidence in ('low','medium','high')),
  likely_impact text,
  recommended_action text,
  status text not null default 'open' check (status in ('open','acknowledged','resolved','dismissed')),
  verification_status text not null default 'unverified' check (verification_status in ('unverified','suspected','confirmed','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists risk_alerts_tenant_status_idx on public.risk_alerts(tenant_id, status);
create index if not exists risk_alerts_tenant_case_idx on public.risk_alerts(tenant_id, case_id);
-- one live alert per event+case pair
create unique index if not exists risk_alerts_live_event_case_uidx
on public.risk_alerts (event_id, (coalesce(case_id, '00000000-0000-0000-0000-000000000000'::uuid)))
where status in ('open','acknowledged');

create table if not exists public.risk_alert_verifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  alert_id uuid not null references public.risk_alerts(id) on delete cascade,
  decision text not null check (decision in ('confirmed','rejected','needs_review')),
  notes text,
  decided_by uuid not null,
  decided_at timestamptz not null default now()
);

create index if not exists risk_alert_verifications_alert_idx on public.risk_alert_verifications(alert_id, decided_at desc);

create table if not exists public.cost_recovery_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  alert_id uuid references public.risk_alerts(id) on delete set null,
  event_id uuid references public.risk_events(id) on delete set null,
  case_id uuid not null references public.cases(id) on delete cascade,
  cost_category text not null check (cost_category in ('demurrage','detention','storage','missed_delivery_slot','additional_transport','other')),
  amount numeric(14,2),
  currency text not null default 'ZAR',
  status text not null default 'potential' check (status in ('potential','under_investigation','recoverable','recovered','not_recoverable')),
  evidence_ref text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (alert_id is not null or event_id is not null)
);

create index if not exists cost_recovery_links_tenant_case_idx on public.cost_recovery_links(tenant_id, case_id);

create table if not exists public.risk_source_configs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  source text not null,
  enabled boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  max_events_per_day integer not null default 100 check (max_events_per_day between 1 and 10000),
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, source)
);

create or replace function public.cargoiq_risk_tenant_ids()
returns setof uuid
language sql
security definer
set search_path = public
as $$
  select tenant_id
  from public.user_roles
  where user_id = auth.uid();
$$;

revoke all on function public.cargoiq_risk_tenant_ids() from public;
grant execute on function public.cargoiq_risk_tenant_ids() to authenticated;

alter table public.risk_events enable row level security;
alter table public.risk_event_case_links enable row level security;
alter table public.risk_alerts enable row level security;
alter table public.risk_alert_verifications enable row level security;
alter table public.cost_recovery_links enable row level security;
alter table public.risk_source_configs enable row level security;

drop policy if exists risk_events_tenant_select on public.risk_events;
create policy risk_events_tenant_select on public.risk_events
for select to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()));

drop policy if exists risk_events_tenant_modify on public.risk_events;
create policy risk_events_tenant_modify on public.risk_events
for all to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()))
with check (tenant_id in (select public.cargoiq_risk_tenant_ids()));

drop policy if exists risk_event_case_links_tenant_select on public.risk_event_case_links;
create policy risk_event_case_links_tenant_select on public.risk_event_case_links
for select to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()));

drop policy if exists risk_event_case_links_tenant_modify on public.risk_event_case_links;
create policy risk_event_case_links_tenant_modify on public.risk_event_case_links
for all to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()))
with check (tenant_id in (select public.cargoiq_risk_tenant_ids()));

drop policy if exists risk_alerts_tenant_select on public.risk_alerts;
create policy risk_alerts_tenant_select on public.risk_alerts
for select to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()));

drop policy if exists risk_alerts_tenant_modify on public.risk_alerts;
create policy risk_alerts_tenant_modify on public.risk_alerts
for all to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()))
with check (tenant_id in (select public.cargoiq_risk_tenant_ids()));

drop policy if exists risk_alert_verifications_tenant_select on public.risk_alert_verifications;
create policy risk_alert_verifications_tenant_select on public.risk_alert_verifications
for select to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()));

drop policy if exists risk_alert_verifications_tenant_modify on public.risk_alert_verifications;
create policy risk_alert_verifications_tenant_modify on public.risk_alert_verifications
for all to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()))
with check (tenant_id in (select public.cargoiq_risk_tenant_ids()));

drop policy if exists cost_recovery_links_tenant_select on public.cost_recovery_links;
create policy cost_recovery_links_tenant_select on public.cost_recovery_links
for select to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()));

drop policy if exists cost_recovery_links_tenant_modify on public.cost_recovery_links;
create policy cost_recovery_links_tenant_modify on public.cost_recovery_links
for all to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()))
with check (tenant_id in (select public.cargoiq_risk_tenant_ids()));

drop policy if exists risk_source_configs_tenant_select on public.risk_source_configs;
create policy risk_source_configs_tenant_select on public.risk_source_configs
for select to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()));

drop policy if exists risk_source_configs_tenant_modify on public.risk_source_configs;
create policy risk_source_configs_tenant_modify on public.risk_source_configs
for all to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()))
with check (tenant_id in (select public.cargoiq_risk_tenant_ids()));
