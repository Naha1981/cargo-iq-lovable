-- Atomic per-day claim for the daily AI health email.
--
-- Why this exists: a read-before-send marker (checked, sent, then written)
-- cannot provide exactly-once delivery - two concurrent invocations both
-- pass the check, a provider-accepted send whose response is lost looks
-- unsent, and a failed marker write after a successful send causes a resend.
-- Exactly-once here rests on two rails:
--   1. one row per UTC day with a PRIMARY KEY, claimed atomically via
--      INSERT ... ON CONFLICT DO NOTHING - only one invocation can hold the
--      'sending' lease at a time;
--   2. the Resend Idempotency-Key header keyed to the same day, so a retry
--      after an ambiguous outcome cannot make the provider send twice.
-- An expired lease or a failed/unknown send is NEVER automatically resent:
-- the row stays owner-visible ('unknown') until the owner reviews it.

create table public.health_email_sends (
  day date primary key,                              -- UTC day being claimed
  status text not null default 'sending'
    check (status in ('sending', 'sent', 'send_failed', 'unknown')),
  lease_expires_at timestamptz not null,             -- bounds the sending lease
  provider_message_id text,
  detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.health_email_sends enable row level security;
-- No policies: not readable by client roles. Only the service role (cron)
-- touches it; the owner reviews rows via the dashboard/SQL editor.

revoke all on public.health_email_sends from anon, authenticated;

-- Atomically claim a day. Returns exactly one of:
--   'claimed'       - this call holds the lease and may send
--   'already_sent'  - a previous send was confirmed; do nothing
--   'in_progress'   - another invocation holds a live lease; do nothing
--   'unknown'       - lease expired or send failed without confirmation;
--                     owner review required, NEVER auto-resend
create or replace function public.claim_health_email_day(p_day date, p_lease interval default '5 minutes')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.health_email_sends%rowtype;
begin
  insert into public.health_email_sends (day, status, lease_expires_at)
  values (p_day, 'sending', now() + p_lease)
  on conflict (day) do nothing;
  if found then
    return 'claimed';
  end if;

  select * into existing from public.health_email_sends where day = p_day;
  if existing.status = 'sent' then
    return 'already_sent';
  elsif existing.status = 'sending' and existing.lease_expires_at > now() then
    return 'in_progress';
  else
    -- expired lease, send_failed, or unknown: ambiguous outcome, owner-visible.
    update public.health_email_sends
      set status = 'unknown', updated_at = now()
      where day = p_day and status <> 'unknown';
    return 'unknown';
  end if;
end;
$$;

-- Confirm a send after the provider accepted it. Only the lease holder's
-- own claim can be completed; a no-op otherwise.
create or replace function public.complete_health_email_day(p_day date, p_provider_message_id text default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.health_email_sends
    set status = 'sent', provider_message_id = p_provider_message_id, updated_at = now()
    where day = p_day and status = 'sending';
$$;

-- Record a definitive provider rejection (the provider did NOT accept).
-- Not retried automatically: the next claim maps this to 'unknown' for
-- owner review, because response ambiguity can never be ruled out here.
create or replace function public.fail_health_email_day(p_day date, p_detail text default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.health_email_sends
    set status = 'send_failed', detail = left(coalesce(p_detail, ''), 500), updated_at = now()
    where day = p_day and status = 'sending';
$$;

revoke all on function public.claim_health_email_day(date, interval) from public, anon, authenticated;
revoke all on function public.complete_health_email_day(date, text) from public, anon, authenticated;
revoke all on function public.fail_health_email_day(date, text) from public, anon, authenticated;
grant execute on function public.claim_health_email_day(date, interval) to service_role;
grant execute on function public.complete_health_email_day(date, text) to service_role;
grant execute on function public.fail_health_email_day(date, text) to service_role;

-- Owner-readable delivery state for the admin panel (no client-table access):
-- platform admins (or the service role) read recent day rows as jsonb.
create or replace function public.admin_list_health_email_sends(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (
    public.is_platform_admin()
    or coalesce(auth.jwt() ->> 'role', '') = 'service_role'
  ) then
    raise exception 'FORBIDDEN';
  end if;
  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'day', h.day,
          'status', h.status,
          'detail', h.detail,
          'provider_message_id', h.provider_message_id,
          'updated_at', h.updated_at
        )
        order by h.day desc
      )
      from (
        select * from public.health_email_sends
        order by day desc
        limit greatest(1, least(p_days, 31))
      ) h
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.admin_list_health_email_sends(integer) from public, anon;
grant execute on function public.admin_list_health_email_sends(integer) to authenticated;
