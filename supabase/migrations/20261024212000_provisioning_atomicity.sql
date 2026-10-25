-- Close the duplicate-workspace race in provision_organization (audit item 3, partial).
-- Two concurrent first sign-ins could both find no membership and each insert a
-- tenant. Fix: a per-user advisory transaction lock, then re-check membership
-- inside the lock. The raced second call waits, then finds the membership and
-- returns the existing tenant. No new constraints and no change to membership
-- semantics: users can still hold multiple roles or workspaces if the product
-- adds them later.
-- PARTIAL: the client also references an rpc name "ln" whose live definition is
-- not in this repo (hand-applied). Reconcile that contract against the Block 1
-- live-check result before claiming the race closed on every provisioning path.
-- Additive: no data changed.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('cargoiq-provisioning-atomicity-v1',0));

DO $pre$
BEGIN
  IF to_regclass('public.user_roles') IS NULL OR to_regclass('public.tenants') IS NULL THEN
    RAISE EXCEPTION 'tenants/user_roles missing - wrong project or base schema not applied';
  END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.provision_organization(org_name text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); t uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  -- Serialize concurrent first-time provisioning for the same user.
  PERFORM pg_advisory_xact_lock(hashtextextended('cargoiq-provision:' || uid::text, 0));
  -- Re-check inside the lock: a raced call that waited now sees the membership.
  SELECT tenant_id INTO t FROM public.user_roles WHERE user_id = uid ORDER BY created_at LIMIT 1;
  IF t IS NOT NULL THEN RETURN t; END IF;
  INSERT INTO public.tenants (name) VALUES (COALESCE(NULLIF(trim(org_name),''), 'My investigations workspace')) RETURNING id INTO t;
  INSERT INTO public.user_roles (user_id, tenant_id, role) VALUES (uid, t, 'admin');
  PERFORM public.seed_demo_case(t, uid);
  RETURN t;
END $$;
COMMIT;
SELECT 'provisioning_atomicity_applied' AS result;
