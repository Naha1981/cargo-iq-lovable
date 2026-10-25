-- Tenant invitations: safe team onboarding.
-- Security properties (review notes):
-- * The invitation email is BINDING: accept requires the signed-in user's
--   auth email to match the invited email (case-insensitive). A forwarded
--   link alone grants nothing.
-- * Single use + expiry: accept marks accepted_at atomically; an accepted or
--   expired invitation cannot be replayed.
-- * INSERT-only membership: accepting never updates an existing user_roles
--   row, so an invitation can never silently change an existing member's
--   role. Role changes stay on a separate owner path.
-- * Direct table access is denied to every non-superuser role (RLS enabled,
--   no policies); all access goes through SECURITY DEFINER functions with
--   repo-standard REVOKE/GRANT hardening.

CREATE TABLE IF NOT EXISTS public.tenant_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','investigator','viewer')),
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  invited_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_invitations_token_key ON public.tenant_invitations (token);
ALTER TABLE public.tenant_invitations ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: direct table access is denied to every non-superuser role.

-- Helper: is the current user an admin of this tenant? SECURITY DEFINER so
-- policies on user_roles are not recursively evaluated.
CREATE OR REPLACE FUNCTION public.is_tenant_admin(p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND tenant_id = p_tenant_id AND role = 'admin'
  );
$$;
REVOKE ALL ON FUNCTION public.is_tenant_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_tenant_admin(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_tenant_invitation(p_tenant_id uuid, p_email text, p_role text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_token uuid; v_expires timestamptz;
BEGIN
  IF NOT public.is_tenant_admin(p_tenant_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_role NOT IN ('admin','investigator','viewer') THEN RAISE EXCEPTION 'INVALID_ROLE'; END IF;
  IF p_email IS NULL OR position('@' in p_email) < 2 THEN RAISE EXCEPTION 'INVALID_EMAIL'; END IF;
  INSERT INTO public.tenant_invitations (tenant_id, email, role)
  VALUES (p_tenant_id, lower(trim(p_email)), p_role)
  RETURNING id, token, expires_at INTO v_id, v_token, v_expires;
  RETURN jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_expires);
END;
$$;
REVOKE ALL ON FUNCTION public.create_tenant_invitation(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_tenant_invitation(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_tenant_invitations(p_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_tenant_admin(p_tenant_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', i.id, 'email', i.email, 'role', i.role,
      'expires_at', i.expires_at, 'accepted_at', i.accepted_at,
      'expired', i.expires_at < now()))
    FROM public.tenant_invitations i
    WHERE i.tenant_id = p_tenant_id), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.list_tenant_invitations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_tenant_invitations(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_tenant_invitation(p_invitation_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public.tenant_invitations WHERE id = p_invitation_id;
  IF v_tenant IS NULL THEN RETURN 'not_found'; END IF;
  IF NOT public.is_tenant_admin(v_tenant) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  DELETE FROM public.tenant_invitations WHERE id = p_invitation_id AND accepted_at IS NULL;
  RETURN 'revoked';
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_tenant_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_tenant_invitation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_tenant_invitation(p_token uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inv public.tenant_invitations%ROWTYPE;
  v_email text;
  v_inserted integer;
BEGIN
  -- Claim the invitation atomically: single use, unexpired only.
  UPDATE public.tenant_invitations
  SET accepted_at = now(), accepted_by = auth.uid()
  WHERE token = p_token AND accepted_at IS NULL AND expires_at > now()
  RETURNING * INTO v_inv;
  IF NOT FOUND THEN RETURN 'invalid_or_expired'; END IF;

  -- The invitation email must match the accepting user's auth email.
  SELECT lower(coalesce(auth.jwt() ->> 'email', '')) INTO v_email;
  IF v_email = '' OR v_email <> v_inv.email THEN
    -- Unclaim: this user may not consume someone else's invitation.
    UPDATE public.tenant_invitations
    SET accepted_at = NULL, accepted_by = NULL
    WHERE id = v_inv.id;
    RETURN 'email_mismatch';
  END IF;

  -- INSERT-only membership: never overwrite an existing role, and do not
  -- rely on a unique constraint the base schema may not have.
  INSERT INTO public.user_roles (user_id, tenant_id, role)
  SELECT auth.uid(), v_inv.tenant_id, v_inv.role
  WHERE NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND tenant_id = v_inv.tenant_id
  );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    RETURN 'already_member';
  END IF;
  RETURN 'joined';
END;
$$;
REVOKE ALL ON FUNCTION public.accept_tenant_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_tenant_invitation(uuid) TO authenticated;
