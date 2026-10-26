-- Revenue Recovery Engine: reviewable findings with strict status machine and immutable audit.
create table if not exists public.recovery_findings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  case_id uuid references public.cases(id),
  finding_type text not null check (finding_type in (
    'duplicate_invoice_charge','missed_billing','avoidable_demurrage_detention',
    'contract_charge_discrepancy','unmatched_supplier_charge','third_party_recoverable')),
  status text not null default 'new' check (status in (
    'new','under_review','approved','rejected','submitted','recovered')),
  title text not null,
  expected_amount numeric(14,2),
  actual_amount numeric(14,2),
  currency text not null default 'ZAR',
  calculation jsonb not null default '{}'::jsonb,
  evidence_refs jsonb not null default '[]'::jsonb,
  source_document_ids uuid[] not null default '{}',
  assigned_to uuid,
  created_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.recovery_finding_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  finding_id uuid not null references public.recovery_findings(id) on delete cascade,
  action text not null,
  actor uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.recovery_findings enable row level security;
alter table public.recovery_finding_events enable row level security;


create index if not exists recovery_findings_case_idx on public.recovery_findings(case_id);
create index if not exists recovery_findings_status_idx on public.recovery_findings(tenant_id, status);
create index if not exists recovery_finding_events_finding_idx on public.recovery_finding_events(finding_id);

-- Hardened permissions: readers may read; only workspace investigators/admins write.
-- Audit records are append-only for authenticated clients, never update/delete.
create policy recovery_findings_read on public.recovery_findings for select to authenticated using (exists (select 1 from public.user_roles r where r.tenant_id = recovery_findings.tenant_id and r.user_id = auth.uid()));
create policy recovery_findings_insert on public.recovery_findings for insert to authenticated with check (exists (select 1 from public.user_roles r where r.tenant_id = recovery_findings.tenant_id and r.user_id = auth.uid() and r.role in ('admin','investigator')) and (case_id is null or exists (select 1 from public.cases c where c.id = recovery_findings.case_id and c.tenant_id = recovery_findings.tenant_id)) and (select count(distinct d.id) from public.documents d where d.id = any(recovery_findings.source_document_ids) and d.tenant_id = recovery_findings.tenant_id and (recovery_findings.case_id is null or d.case_id = recovery_findings.case_id)) = cardinality(recovery_findings.source_document_ids) and (assigned_to is null or exists (select 1 from public.user_roles a where a.user_id = recovery_findings.assigned_to and a.tenant_id = recovery_findings.tenant_id and a.role in ('admin','investigator'))));
create policy recovery_findings_update on public.recovery_findings for update to authenticated using (exists (select 1 from public.user_roles r where r.tenant_id = recovery_findings.tenant_id and r.user_id = auth.uid() and r.role in ('admin','investigator'))) with check (exists (select 1 from public.user_roles r where r.tenant_id = recovery_findings.tenant_id and r.user_id = auth.uid() and r.role in ('admin','investigator')) and (case_id is null or exists (select 1 from public.cases c where c.id = recovery_findings.case_id and c.tenant_id = recovery_findings.tenant_id)) and (select count(distinct d.id) from public.documents d where d.id = any(recovery_findings.source_document_ids) and d.tenant_id = recovery_findings.tenant_id and (recovery_findings.case_id is null or d.case_id = recovery_findings.case_id)) = cardinality(recovery_findings.source_document_ids) and (assigned_to is null or exists (select 1 from public.user_roles a where a.user_id = recovery_findings.assigned_to and a.tenant_id = recovery_findings.tenant_id and a.role in ('admin','investigator'))));
create policy recovery_finding_events_read on public.recovery_finding_events for select to authenticated using (exists (select 1 from public.user_roles r where r.tenant_id = recovery_finding_events.tenant_id and r.user_id = auth.uid()));
create policy recovery_finding_events_insert on public.recovery_finding_events for insert to authenticated with check (exists (select 1 from public.user_roles r where r.tenant_id = recovery_finding_events.tenant_id and r.user_id = auth.uid() and r.role in ('admin','investigator')) and actor = auth.uid() and exists (select 1 from public.recovery_findings p where p.id = recovery_finding_events.finding_id and p.tenant_id = recovery_finding_events.tenant_id));
