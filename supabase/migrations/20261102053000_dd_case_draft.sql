-- Additive draft storage only. No existing evidence, findings or money is changed.
alter table public.cases add column if not exists dd_evidence_draft jsonb;
alter table public.cases add column if not exists dd_evidence_draft_revision integer not null default 0;

create or replace function public.cargoiq_load_dd_draft(p_case_id uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare c public.cases%rowtype;
begin
  select * into c from public.cases where id = p_case_id and exists (
    select 1 from public.user_roles r where r.tenant_id = cases.tenant_id and r.user_id = auth.uid()
  );
  if not found then raise exception 'CASE_NOT_FOUND'; end if;
  return jsonb_build_object('draft', c.dd_evidence_draft, 'revision', c.dd_evidence_draft_revision);
end; $$;

create or replace function public.cargoiq_save_dd_draft(p_case_id uuid, p_revision integer, p_draft jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare c public.cases%rowtype;
begin
  if jsonb_typeof(p_draft) <> 'object' or p_draft is null or octet_length(p_draft::text) > 500000 then
    raise exception 'INVALID_DRAFT';
  end if;
  -- Lock serializes editors. Both case ownership and write role are checked in SQL,
  -- not only in the server handler, because authenticated clients can invoke RPCs.
  select * into c from public.cases where id = p_case_id and exists (
    select 1 from public.user_roles r where r.tenant_id = cases.tenant_id and r.user_id = auth.uid()
      and r.role in ('admin', 'investigator')
  ) for update;
  if not found then raise exception 'CASE_NOT_FOUND_OR_READ_ONLY'; end if;
  if p_revision is null or p_revision <> c.dd_evidence_draft_revision then
    raise exception 'DRAFT_CONFLICT';
  end if;
  update public.cases set dd_evidence_draft = p_draft,
    dd_evidence_draft_revision = c.dd_evidence_draft_revision + 1 where id = c.id;
  return jsonb_build_object('revision', c.dd_evidence_draft_revision + 1);
end; $$;
revoke all on function public.cargoiq_load_dd_draft(uuid) from public, anon;
revoke all on function public.cargoiq_save_dd_draft(uuid, integer, jsonb) from public, anon;
grant execute on function public.cargoiq_load_dd_draft(uuid) to authenticated;
grant execute on function public.cargoiq_save_dd_draft(uuid, integer, jsonb) to authenticated;
