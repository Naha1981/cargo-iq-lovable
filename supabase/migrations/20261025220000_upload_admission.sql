-- Upload admission semaphore (handover requirement: aggregate admission control for
-- concurrent uploads, owner-settable without a developer). Bounds how many uploads may
-- be in flight at once - per workspace and across the whole deployment - so a burst of
-- concurrent uploads queues honestly instead of saturating the database (25 Oct staging
-- finding: simultaneous bursts intermittently failed closed on the free Nano).
--
-- Scope honesty: this gates the APP's upload pipeline (storage PUT is bracketed by a
-- cooperative client acquire, and document registration verifies the lease). It cannot
-- gate raw storage endpoint traffic outside the app. Leases are rows with a TTL, so a
-- crashed client never holds a slot forever; acquisition is serialized by one advisory
-- lock so the check-and-insert is atomic (no count race).
--
-- Config: the app passes env defaults (CLAIM_UPLOAD_TENANT_CONCURRENCY,
-- CLAIM_UPLOAD_GLOBAL_CONCURRENCY). A per-workspace owner override in
-- tenant_upload_concurrency wins over the env default. NULL/<=0 everywhere means the
-- gate is explicitly UNCONFIGURED and uploads are not bounded - this state is visible
-- in the owner panel, never silently treated as bounded.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='30s';
SELECT pg_advisory_xact_lock(hashtextextended('cargoiq-upload-admission-v1',0));

CREATE TABLE IF NOT EXISTS public.upload_leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  acquired_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.upload_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.upload_leases FROM anon;
-- RPC-only: zero policies, no direct grants.

CREATE TABLE IF NOT EXISTS public.tenant_upload_concurrency (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  max_concurrent integer CHECK (max_concurrent IS NULL OR (max_concurrent >= 0 AND max_concurrent <= 100)),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tenant_upload_concurrency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_upload_concurrency FROM anon;
-- RPC-only: zero policies; only platform admins reach it through the functions here.

-- Acquire a slot. Returns the lease uuid, or NULL when at cap. The advisory lock makes
-- expire-count-insert atomic within the calling transaction, so two concurrent
-- acquisitions cannot both pass the same last slot.
CREATE OR REPLACE FUNCTION public.acquire_upload_slot(
  p_tenant_id uuid, p_tenant_max integer, p_global_max integer, p_ttl_seconds integer
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_max integer; v_id uuid;
BEGIN
  IF NOT public.is_tenant_member(p_tenant_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cargoiq-upload-admission-v1',0));
  DELETE FROM public.upload_leases
   WHERE acquired_at < now() - make_interval(secs => greatest(coalesce(p_ttl_seconds,300),30));
  IF p_tenant_max IS NOT NULL AND p_tenant_max > 0 THEN
    SELECT c.max_concurrent INTO v_max FROM public.tenant_upload_concurrency c
     WHERE c.tenant_id = p_tenant_id;
    v_max := coalesce(v_max, p_tenant_max);
    -- An explicit per-workspace 0 means uploads disabled for this workspace.
    IF v_max <= 0 THEN RETURN NULL; END IF;
    IF (SELECT count(*) FROM public.upload_leases WHERE tenant_id = p_tenant_id) >= v_max THEN
      RETURN NULL;
    END IF;
  END IF;
  IF p_global_max IS NOT NULL AND p_global_max > 0
     AND (SELECT count(*) FROM public.upload_leases) >= p_global_max THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.upload_leases(tenant_id) VALUES (p_tenant_id) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION public.acquire_upload_slot(uuid, integer, integer, integer) TO authenticated;

-- Verify a live lease held by this workspace (registration-time enforcement).
CREATE OR REPLACE FUNCTION public.verify_upload_lease(
  p_lease_id uuid, p_tenant_id uuid, p_ttl_seconds integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_ok boolean;
BEGIN
  IF NOT public.is_tenant_member(p_tenant_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.upload_leases
     WHERE id = p_lease_id AND tenant_id = p_tenant_id
       AND acquired_at >= now() - make_interval(secs => greatest(coalesce(p_ttl_seconds,300),30))
  ) INTO v_ok;
  RETURN v_ok;
END $$;
GRANT EXECUTE ON FUNCTION public.verify_upload_lease(uuid, uuid, integer) TO authenticated;

-- Release a slot (idempotent). Only the holding workspace can release its lease.
CREATE OR REPLACE FUNCTION public.release_upload_slot(p_lease_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.upload_leases WHERE id = p_lease_id;
  IF v_tenant IS NULL THEN RETURN; END IF;
  IF NOT public.is_tenant_member(v_tenant) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  DELETE FROM public.upload_leases WHERE id = p_lease_id;
END $$;
GRANT EXECUTE ON FUNCTION public.release_upload_slot(uuid) TO authenticated;

-- Owner controls: set/clear a workspace override (NULL = inherit env default,
-- 0 = uploads disabled for that workspace) and list current overrides.
CREATE OR REPLACE FUNCTION public.admin_set_tenant_upload_concurrency(p_tenant_id uuid, p_max integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  INSERT INTO public.tenant_upload_concurrency(tenant_id, max_concurrent, updated_by, updated_at)
  VALUES (p_tenant_id, p_max, auth.uid(), now())
  ON CONFLICT (tenant_id) DO UPDATE
    SET max_concurrent = EXCLUDED.max_concurrent, updated_by = EXCLUDED.updated_by, updated_at = now();
END $$;
GRANT EXECUTE ON FUNCTION public.admin_set_tenant_upload_concurrency(uuid, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_tenant_upload_concurrency()
RETURNS TABLE(tenant_id uuid, max_concurrent integer, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN QUERY SELECT c.tenant_id, c.max_concurrent, c.updated_at
    FROM public.tenant_upload_concurrency c ORDER BY c.updated_at DESC;
END $$;
GRANT EXECUTE ON FUNCTION public.admin_list_tenant_upload_concurrency() TO authenticated;

COMMIT;
