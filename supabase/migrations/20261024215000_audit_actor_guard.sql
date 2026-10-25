-- Close forged-actor audit inserts (audit item 1 residual): the append-only
-- trigger stops tamper, but an authenticated user could still INSERT audit rows
-- naming another user as actor through direct REST calls.
-- Authenticated inserts must name the caller; server (service-role) writes carry
-- auth.uid()=NULL and keep setting the actor explicitly. Trigger is SECURITY
-- INVOKER so it cannot be used to read across tenants.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('cargoiq-audit-actor-guard-v1',0));

CREATE OR REPLACE FUNCTION public.guard_audit_actor() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.actor_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'AUDIT_ACTOR_MISMATCH';
  END IF;
  RETURN NEW;
END $$;

DO $guard$
BEGIN
  IF to_regclass('public.audit_log') IS NULL THEN
    RAISE EXCEPTION 'audit_log missing - not the expected CargoIQ schema';
  END IF;
  -- Verify-or-abort idempotency, same rule as the other guards.
  IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.audit_log'::regclass AND tgname='audit_actor_guard' AND NOT tgisinternal) THEN
    IF NOT EXISTS(SELECT 1 FROM pg_trigger tg JOIN pg_proc fp ON fp.oid=tg.tgfoid
                  WHERE tg.tgrelid='public.audit_log'::regclass AND tg.tgname='audit_actor_guard' AND NOT tg.tgisinternal
                    AND fp.proname='guard_audit_actor'
                    AND fp.prosrc LIKE '%AUDIT_ACTOR_MISMATCH%') THEN
      RAISE EXCEPTION 'audit_actor_guard exists with an unexpected definition - inspect before continuing';
    END IF;
  ELSE
    CREATE TRIGGER audit_actor_guard BEFORE INSERT ON public.audit_log
      FOR EACH ROW EXECUTE FUNCTION public.guard_audit_actor();
  END IF;
END $guard$;
COMMIT;
SELECT 'audit_actor_guard_applied' AS result,
 (SELECT count(*) FROM pg_trigger WHERE tgname='audit_actor_guard' AND NOT tgisinternal)=1 AS actor_guard;
