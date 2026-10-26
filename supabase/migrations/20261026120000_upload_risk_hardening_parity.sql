-- Parity with the 2026-10-26 production hardening (owner-applied repair script
-- prod-repair-upload-and-risk-v3.sql). The original migrations 20261025220000 and
-- 20261026100000 created the upload-admission and logistics-risk objects with loose
-- FOR ALL policies and default PUBLIC execute grants. Production was hardened
-- separately; this migration brings fresh database builds to the SAME final state:
-- member read / admin+investigator write with same-tenant parent checks, and the
-- six RPCs executable by authenticated only. Idempotent: drops before creates.
BEGIN;

-- Upload admission RPCs: close the default PUBLIC/anon execute grant.
REVOKE ALL ON FUNCTION public.acquire_upload_slot(uuid, integer, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.verify_upload_lease(uuid, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.release_upload_slot(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_set_tenant_upload_concurrency(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_list_tenant_upload_concurrency() FROM PUBLIC, anon;

-- Risk tenant resolver: authenticated only.
revoke all on function public.cargoiq_risk_tenant_ids() from PUBLIC, anon;
grant execute on function public.cargoiq_risk_tenant_ids() to authenticated;

-- Row-level security. Read: any workspace member. Write: admin/investigator only.
-- Child rows must link to parents in the SAME workspace.
alter table public.risk_events enable row level security;
alter table public.risk_event_case_links enable row level security;
alter table public.risk_alerts enable row level security;
alter table public.risk_alert_verifications enable row level security;
alter table public.cost_recovery_links enable row level security;
alter table public.risk_source_configs enable row level security;
-- risk_events (no parent references)
drop policy if exists risk_events_tenant_select on public.risk_events;
create policy risk_events_tenant_select on public.risk_events for select to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()));
drop policy if exists risk_events_tenant_modify on public.risk_events;
drop policy if exists risk_events_tenant_insert on public.risk_events;
create policy risk_events_tenant_insert on public.risk_events for insert to authenticated
with check (EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.tenant_id = risk_events.tenant_id AND ur.role IN ('admin','investigator')));
drop policy if exists risk_events_tenant_update on public.risk_events;
create policy risk_events_tenant_update on public.risk_events for update to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()))
with check (EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.tenant_id = risk_events.tenant_id AND ur.role IN ('admin','investigator')));
drop policy if exists risk_events_tenant_delete on public.risk_events;
create policy risk_events_tenant_delete on public.risk_events for delete to authenticated
using (EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.tenant_id = risk_events.tenant_id AND ur.role IN ('admin','investigator')));

-- risk_event_case_links (parents: risk_events + cases, same workspace required)
drop policy if exists risk_event_case_links_tenant_select on public.risk_event_case_links;
create policy risk_event_case_links_tenant_select on public.risk_event_case_links for select to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()));
drop policy if exists risk_event_case_links_tenant_modify on public.risk_event_case_links;
drop policy if exists risk_event_case_links_tenant_insert on public.risk_event_case_links;
create policy risk_event_case_links_tenant_insert on public.risk_event_case_links for insert to authenticated
with check (EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.tenant_id = risk_event_case_links.tenant_id AND ur.role IN ('admin','investigator'))
  AND EXISTS(SELECT 1 FROM public.risk_events e WHERE e.id = risk_event_case_links.event_id AND e.tenant_id = risk_event_case_links.tenant_id)
  AND EXISTS(SELECT 1 FROM public.cases c WHERE c.id = risk_event_case_links.case_id AND c.tenant_id = risk_event_case_links.tenant_id));
drop policy if exists risk_event_case_links_tenant_update on public.risk_event_case_links;
create policy risk_event_case_links_tenant_update on public.risk_event_case_links for update to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()))
with check (EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.tenant_id = risk_event_case_links.tenant_id AND ur.role IN ('admin','investigator'))
  AND EXISTS(SELECT 1 FROM public.risk_events e WHERE e.id = risk_event_case_links.event_id AND e.tenant_id = risk_event_case_links.tenant_id)
  AND EXISTS(SELECT 1 FROM public.cases c WHERE c.id = risk_event_case_links.case_id AND c.tenant_id = risk_event_case_links.tenant_id));
drop policy if exists risk_event_case_links_tenant_delete on public.risk_event_case_links;
create policy risk_event_case_links_tenant_delete on public.risk_event_case_links for delete to authenticated
using (EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.tenant_id = risk_event_case_links.tenant_id AND ur.role IN ('admin','investigator')));

-- risk_alerts (parent: risk_events; optional case, same workspace required)
drop policy if exists risk_alerts_tenant_select on public.risk_alerts;
create policy risk_alerts_tenant_select on public.risk_alerts for select to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()));
drop policy if exists risk_alerts_tenant_modify on public.risk_alerts;
drop policy if exists risk_alerts_tenant_insert on public.risk_alerts;
create policy risk_alerts_tenant_insert on public.risk_alerts for insert to authenticated
with check (EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.tenant_id = risk_alerts.tenant_id AND ur.role IN ('admin','investigator'))
  AND EXISTS(SELECT 1 FROM public.risk_events e WHERE e.id = risk_alerts.event_id AND e.tenant_id = risk_alerts.tenant_id)
  AND (risk_alerts.case_id IS NULL OR EXISTS(SELECT 1 FROM public.cases c WHERE c.id = risk_alerts.case_id AND c.tenant_id = risk_alerts.tenant_id)));
drop policy if exists risk_alerts_tenant_update on public.risk_alerts;
create policy risk_alerts_tenant_update on public.risk_alerts for update to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()))
with check (EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.tenant_id = risk_alerts.tenant_id AND ur.role IN ('admin','investigator'))
  AND EXISTS(SELECT 1 FROM public.risk_events e WHERE e.id = risk_alerts.event_id AND e.tenant_id = risk_alerts.tenant_id)
  AND (risk_alerts.case_id IS NULL OR EXISTS(SELECT 1 FROM public.cases c WHERE c.id = risk_alerts.case_id AND c.tenant_id = risk_alerts.tenant_id)));
drop policy if exists risk_alerts_tenant_delete on public.risk_alerts;
create policy risk_alerts_tenant_delete on public.risk_alerts for delete to authenticated
using (EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.tenant_id = risk_alerts.tenant_id AND ur.role IN ('admin','investigator')));

-- risk_alert_verifications (parent: risk_alerts, same workspace required)
drop policy if exists risk_alert_verifications_tenant_select on public.risk_alert_verifications;
create policy risk_alert_verifications_tenant_select on public.risk_alert_verifications for select to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()));
drop policy if exists risk_alert_verifications_tenant_modify on public.risk_alert_verifications;
drop policy if exists risk_alert_verifications_tenant_insert on public.risk_alert_verifications;
create policy risk_alert_verifications_tenant_insert on public.risk_alert_verifications for insert to authenticated
with check (EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.tenant_id = risk_alert_verifications.tenant_id AND ur.role IN ('admin','investigator'))
  AND EXISTS(SELECT 1 FROM public.risk_alerts a WHERE a.id = risk_alert_verifications.alert_id AND a.tenant_id = risk_alert_verifications.tenant_id));
drop policy if exists risk_alert_verifications_tenant_update on public.risk_alert_verifications;
create policy risk_alert_verifications_tenant_update on public.risk_alert_verifications for update to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()))
with check (EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.tenant_id = risk_alert_verifications.tenant_id AND ur.role IN ('admin','investigator'))
  AND EXISTS(SELECT 1 FROM public.risk_alerts a WHERE a.id = risk_alert_verifications.alert_id AND a.tenant_id = risk_alert_verifications.tenant_id));
drop policy if exists risk_alert_verifications_tenant_delete on public.risk_alert_verifications;
create policy risk_alert_verifications_tenant_delete on public.risk_alert_verifications for delete to authenticated
using (EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.tenant_id = risk_alert_verifications.tenant_id AND ur.role IN ('admin','investigator')));

-- cost_recovery_links (parents: case required, alert/event optional, same workspace)
drop policy if exists cost_recovery_links_tenant_select on public.cost_recovery_links;
create policy cost_recovery_links_tenant_select on public.cost_recovery_links for select to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()));
drop policy if exists cost_recovery_links_tenant_modify on public.cost_recovery_links;
drop policy if exists cost_recovery_links_tenant_insert on public.cost_recovery_links;
create policy cost_recovery_links_tenant_insert on public.cost_recovery_links for insert to authenticated
with check (EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.tenant_id = cost_recovery_links.tenant_id AND ur.role IN ('admin','investigator'))
  AND EXISTS(SELECT 1 FROM public.cases c WHERE c.id = cost_recovery_links.case_id AND c.tenant_id = cost_recovery_links.tenant_id)
  AND (cost_recovery_links.alert_id IS NULL OR EXISTS(SELECT 1 FROM public.risk_alerts a WHERE a.id = cost_recovery_links.alert_id AND a.tenant_id = cost_recovery_links.tenant_id))
  AND (cost_recovery_links.event_id IS NULL OR EXISTS(SELECT 1 FROM public.risk_events e WHERE e.id = cost_recovery_links.event_id AND e.tenant_id = cost_recovery_links.tenant_id)));
drop policy if exists cost_recovery_links_tenant_update on public.cost_recovery_links;
create policy cost_recovery_links_tenant_update on public.cost_recovery_links for update to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()))
with check (EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.tenant_id = cost_recovery_links.tenant_id AND ur.role IN ('admin','investigator'))
  AND EXISTS(SELECT 1 FROM public.cases c WHERE c.id = cost_recovery_links.case_id AND c.tenant_id = cost_recovery_links.tenant_id)
  AND (cost_recovery_links.alert_id IS NULL OR EXISTS(SELECT 1 FROM public.risk_alerts a WHERE a.id = cost_recovery_links.alert_id AND a.tenant_id = cost_recovery_links.tenant_id))
  AND (cost_recovery_links.event_id IS NULL OR EXISTS(SELECT 1 FROM public.risk_events e WHERE e.id = cost_recovery_links.event_id AND e.tenant_id = cost_recovery_links.tenant_id)));
drop policy if exists cost_recovery_links_tenant_delete on public.cost_recovery_links;
create policy cost_recovery_links_tenant_delete on public.cost_recovery_links for delete to authenticated
using (EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.tenant_id = cost_recovery_links.tenant_id AND ur.role IN ('admin','investigator')));

-- risk_source_configs (no parent references)
drop policy if exists risk_source_configs_tenant_select on public.risk_source_configs;
create policy risk_source_configs_tenant_select on public.risk_source_configs for select to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()));
drop policy if exists risk_source_configs_tenant_modify on public.risk_source_configs;
drop policy if exists risk_source_configs_tenant_insert on public.risk_source_configs;
create policy risk_source_configs_tenant_insert on public.risk_source_configs for insert to authenticated
with check (EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.tenant_id = risk_source_configs.tenant_id AND ur.role IN ('admin','investigator')));
drop policy if exists risk_source_configs_tenant_update on public.risk_source_configs;
create policy risk_source_configs_tenant_update on public.risk_source_configs for update to authenticated
using (tenant_id in (select public.cargoiq_risk_tenant_ids()))
with check (EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.tenant_id = risk_source_configs.tenant_id AND ur.role IN ('admin','investigator')));
drop policy if exists risk_source_configs_tenant_delete on public.risk_source_configs;
create policy risk_source_configs_tenant_delete on public.risk_source_configs for delete to authenticated
using (EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.tenant_id = risk_source_configs.tenant_id AND ur.role IN ('admin','investigator')));


COMMIT;
