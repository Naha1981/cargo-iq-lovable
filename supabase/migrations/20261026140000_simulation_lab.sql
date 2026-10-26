-- CargoIQ Simulation Lab (Risk Intelligence -> Simulation Lab).
-- Scenario builder, baseline-vs-scenario comparison, operational decision
-- record, and persistent audit trail. Deterministic calculations only;
-- scenario assumptions are hypothetical inputs, never verified evidence.
-- Tenant-scoped with the same policy pattern as the risk-intelligence tables.

create table if not exists public.simulation_scenarios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  scenario_type text not null check (scenario_type in
    ('flood_corridor','port_congestion','road_closure','severe_weather','border_delay','facility_outage','other')),
  status text not null default 'draft' check (status in ('draft','compared','decided','archived')),
  -- Hypothetical scope: free-text area plus optional corridor/port/vessel keys
  -- that match the existing risk/case model. All scenario content is
  -- ASSUMPTION, labelled as such; never a verified incident record.
  area_description text,
  port_code text,
  corridor text,
  vessel_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  severity text not null default 'medium' check (severity in ('low','medium','high')),
  assumptions jsonb not null default '[]'::jsonb,       -- [{text, source:'user'|'measurement', label:'ASSUMPTION'|'MEASURED'}]
  evidence_refs jsonb not null default '[]'::jsonb,     -- [{kind:'risk_event'|'document'|'observation', id, noted_at}]
  baseline_metrics jsonb,                                -- computed, reproducible
  scenario_metrics jsonb,                                -- computed, reproducible
  comparison_summary jsonb,                              -- {metrics, labels, evidence_gaps[], insufficient_data[]}
  decision_summary text,
  decision_action text,
  decided_by uuid,
  decided_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists simulation_scenarios_tenant_idx on public.simulation_scenarios (tenant_id, created_at desc);

create table if not exists public.simulation_scenario_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  scenario_id uuid not null references public.simulation_scenarios(id) on delete cascade,
  action text not null check (action in ('created','updated','compared','decision_recorded','reopened','archived')),
  actor uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists simulation_scenario_events_scenario_idx on public.simulation_scenario_events (scenario_id, created_at);

alter table public.simulation_scenarios enable row level security;
alter table public.simulation_scenario_events enable row level security;











-- Hardened permissions: readers may read; only workspace investigators/admins write.
-- Audit records are append-only for authenticated clients, never update/delete.
create policy simulation_scenarios_read on public.simulation_scenarios for select to authenticated using (exists (select 1 from public.user_roles r where r.tenant_id = simulation_scenarios.tenant_id and r.user_id = auth.uid()));
create policy simulation_scenarios_insert on public.simulation_scenarios for insert to authenticated with check (exists (select 1 from public.user_roles r where r.tenant_id = simulation_scenarios.tenant_id and r.user_id = auth.uid() and r.role in ('admin','investigator')));
create policy simulation_scenarios_update on public.simulation_scenarios for update to authenticated using (exists (select 1 from public.user_roles r where r.tenant_id = simulation_scenarios.tenant_id and r.user_id = auth.uid() and r.role in ('admin','investigator'))) with check (exists (select 1 from public.user_roles r where r.tenant_id = simulation_scenarios.tenant_id and r.user_id = auth.uid() and r.role in ('admin','investigator')));
create policy simulation_scenario_events_read on public.simulation_scenario_events for select to authenticated using (exists (select 1 from public.user_roles r where r.tenant_id = simulation_scenario_events.tenant_id and r.user_id = auth.uid()));
create policy simulation_scenario_events_insert on public.simulation_scenario_events for insert to authenticated with check (exists (select 1 from public.user_roles r where r.tenant_id = simulation_scenario_events.tenant_id and r.user_id = auth.uid() and r.role in ('admin','investigator')) and actor = auth.uid() and exists (select 1 from public.simulation_scenarios p where p.id = simulation_scenario_events.scenario_id and p.tenant_id = simulation_scenario_events.tenant_id));
