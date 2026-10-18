-- Teams and multiple workspaces. Idempotent. Rollback: supabase/rollback/20261018190000_teams_and_workspaces.down.sql

CREATE TABLE IF NOT EXISTS public.tenant_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  role public.app_role NOT NULL DEFAULT 'investigator',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tenant_invites ENABLE ROW LEVEL SECURITY;
-- no client policies: all access goes through the functions below.

CREATE OR REPLACE FUNCTION public.is_tenant_admin(_tenant_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND tenant_id = _tenant_id AND role = 'admin');
$$;
CREATE OR REPLACE FUNCTION public.is_tenant_viewer(_tenant_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND tenant_id = _tenant_id AND role = 'viewer');
$$;

CREATE OR REPLACE FUNCTION public.my_workspaces() RETURNS TABLE(tenant_id uuid, name text, role public.app_role)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.tenant_id, t.name, r.role FROM user_roles r JOIN tenants t ON t.id = r.tenant_id
  WHERE r.user_id = auth.uid() ORDER BY r.created_at;
$$;

CREATE OR REPLACE FUNCTION public.create_workspace(org_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); t uuid; n int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  SELECT count(*) INTO n FROM user_roles WHERE user_id = uid AND role = 'admin';
  IF n >= 20 THEN RAISE EXCEPTION 'WORKSPACE_LIMIT'; END IF;
  INSERT INTO tenants (name) VALUES (COALESCE(NULLIF(left(trim(org_name),80),''), 'New workspace')) RETURNING id INTO t;
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (uid, t, 'admin');
  PERFORM seed_demo_case(t, uid);
  RETURN t;
END $$;

CREATE OR REPLACE FUNCTION public.create_invite(_tenant uuid, _role public.app_role DEFAULT 'investigator') RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tok text;
BEGIN
  IF NOT public.is_tenant_admin(_tenant) THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF _role = 'admin' THEN RAISE EXCEPTION 'INVITE_ROLE_NOT_ALLOWED'; END IF;
  UPDATE tenant_invites SET revoked_at = now() WHERE tenant_id = _tenant AND revoked_at IS NULL;
  tok := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  INSERT INTO tenant_invites (tenant_id, token, role, created_by) VALUES (_tenant, tok, _role, auth.uid());
  RETURN tok;
END $$;

CREATE OR REPLACE FUNCTION public.revoke_invite(_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_tenant_admin(_tenant) THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  UPDATE tenant_invites SET revoked_at = now() WHERE tenant_id = _tenant AND revoked_at IS NULL;
END $$;

CREATE OR REPLACE FUNCTION public.current_invite(_tenant uuid) RETURNS TABLE(token text, role public.app_role, expires_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_tenant_admin(_tenant) THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  RETURN QUERY SELECT i.token, i.role, i.expires_at FROM tenant_invites i
    WHERE i.tenant_id = _tenant AND i.revoked_at IS NULL AND i.expires_at > now() ORDER BY i.created_at DESC LIMIT 1;
END $$;

CREATE OR REPLACE FUNCTION public.invite_info(_token text) RETURNS TABLE(org_name text, role public.app_role)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.name, i.role FROM tenant_invites i JOIN tenants t ON t.id = i.tenant_id
  WHERE i.token = _token AND i.revoked_at IS NULL AND i.expires_at > now();
$$;

CREATE OR REPLACE FUNCTION public.accept_invite(_token text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); inv tenant_invites%ROWTYPE;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  SELECT * INTO inv FROM tenant_invites WHERE token = _token AND revoked_at IS NULL AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'INVITE_INVALID'; END IF;
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (uid, inv.tenant_id, inv.role)
    ON CONFLICT (user_id, tenant_id) DO NOTHING;
  RETURN inv.tenant_id;
END $$;

CREATE OR REPLACE FUNCTION public.list_members(_tenant uuid) RETURNS TABLE(user_id uuid, email text, role public.app_role, joined_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_tenant_member(_tenant) THEN RAISE EXCEPTION 'NOT_A_MEMBER'; END IF;
  RETURN QUERY SELECT r.user_id, u.email::text, r.role, r.created_at FROM user_roles r JOIN auth.users u ON u.id = r.user_id
    WHERE r.tenant_id = _tenant ORDER BY r.created_at;
END $$;

CREATE OR REPLACE FUNCTION public.set_member_role(_tenant uuid, _user uuid, _role public.app_role) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_tenant_admin(_tenant) THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF _role <> 'admin' AND (SELECT count(*) FROM user_roles WHERE tenant_id = _tenant AND role = 'admin' AND user_id <> _user) = 0 THEN
    RAISE EXCEPTION 'LAST_ADMIN';
  END IF;
  UPDATE user_roles SET role = _role WHERE tenant_id = _tenant AND user_id = _user;
END $$;

CREATE OR REPLACE FUNCTION public.remove_member(_tenant uuid, _user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _user <> auth.uid() AND NOT public.is_tenant_admin(_tenant) THEN RAISE EXCEPTION 'ADMIN_REQUIRED'; END IF;
  IF (SELECT role FROM user_roles WHERE tenant_id = _tenant AND user_id = _user) = 'admin'
     AND (SELECT count(*) FROM user_roles WHERE tenant_id = _tenant AND role = 'admin' AND user_id <> _user) = 0 THEN
    RAISE EXCEPTION 'LAST_ADMIN';
  END IF;
  DELETE FROM user_roles WHERE tenant_id = _tenant AND user_id = _user;
END $$;

-- Viewers are read-only at the database, not just in the app.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT DISTINCT schemaname, tablename FROM pg_policies
           WHERE schemaname = 'public' AND policyname IN ('Tenant insert','Tenant update','Tenant delete') LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Viewers read only (ins)" ON %I.%I', r.schemaname, r.tablename);
    EXECUTE format('CREATE POLICY "Viewers read only (ins)" ON %I.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT public.is_tenant_viewer(tenant_id))', r.schemaname, r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS "Viewers read only (upd)" ON %I.%I', r.schemaname, r.tablename);
    EXECUTE format('CREATE POLICY "Viewers read only (upd)" ON %I.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_tenant_viewer(tenant_id))', r.schemaname, r.tablename);
    EXECUTE format('DROP POLICY IF EXISTS "Viewers read only (del)" ON %I.%I', r.schemaname, r.tablename);
    EXECUTE format('CREATE POLICY "Viewers read only (del)" ON %I.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_tenant_viewer(tenant_id))', r.schemaname, r.tablename);
  END LOOP;
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY[
    'is_tenant_admin(uuid)','is_tenant_viewer(uuid)','my_workspaces()','create_workspace(text)',
    'create_invite(uuid,public.app_role)','revoke_invite(uuid)','current_invite(uuid)','invite_info(text)',
    'accept_invite(text)','list_members(uuid)','set_member_role(uuid,uuid,public.app_role)','remove_member(uuid,uuid)'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- The join page shows the workspace name before sign-in. It returns the name and role only, for a valid token.
GRANT EXECUTE ON FUNCTION public.invite_info(text) TO anon;
