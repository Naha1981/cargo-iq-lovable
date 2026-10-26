-- PROPOSAL ONLY: one NEW invoker RPC, no existing-table/function changes.
-- Requires feature_atomic_audit.sql and the three feature table migrations.
create function public.cargoiq_create_recovery_batch(p_tenant uuid, p_request uuid, p_rows jsonb)
returns setof public.recovery_findings
language plpgsql security invoker set search_path = '' as $$
declare
  r jsonb;
  fingerprint text := md5(p_rows::text);
  previous_fingerprint text;
begin
  if auth.uid() is null or not exists (select 1 from public.user_roles u
    where u.user_id=auth.uid() and u.tenant_id=p_tenant and u.role in ('admin','investigator'))
  then raise exception 'INVESTIGATOR_REQUIRED'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1500
  then raise exception 'INVALID_BATCH'; end if;
  -- Same operation retries serialize across processes. RLS still checks every row.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_tenant::text || ':' || p_request::text,0));
  select calculation->>'request_fingerprint' into previous_fingerprint
    from public.recovery_findings where tenant_id=p_tenant and calculation->>'request_id'=p_request::text limit 1;
  if previous_fingerprint is not null then
    if previous_fingerprint <> fingerprint then raise exception 'REQUEST_KEY_REUSED_WITH_DIFFERENT_INPUT'; end if;
    return query select * from public.recovery_findings where tenant_id=p_tenant and calculation->>'request_id'=p_request::text order by created_at,id;
    return;
  end if;
  for r in select value from jsonb_array_elements(p_rows) loop
    insert into public.recovery_findings(tenant_id,case_id,finding_type,title,expected_amount,actual_amount,currency,calculation,source_document_ids,evidence_refs,created_by)
    values(p_tenant,(r->>'case_id')::uuid,r->>'finding_type',r->>'title',
      (r->>'expected_amount')::numeric,(r->>'actual_amount')::numeric,r->>'currency',
      coalesce(r->'calculation','{}'::jsonb) || jsonb_build_object('request_id',p_request,'request_fingerprint',fingerprint),
      array(select jsonb_array_elements_text(coalesce(r->'source_document_ids','[]'::jsonb)))::uuid[],
      coalesce(r->'evidence_refs','[]'::jsonb),auth.uid());
  end loop;
  return query select * from public.recovery_findings where tenant_id=p_tenant and calculation->>'request_id'=p_request::text order by created_at,id;
end;
$$;
revoke all on function public.cargoiq_create_recovery_batch(uuid,uuid,jsonb) from public;
grant execute on function public.cargoiq_create_recovery_batch(uuid,uuid,jsonb) to authenticated;
