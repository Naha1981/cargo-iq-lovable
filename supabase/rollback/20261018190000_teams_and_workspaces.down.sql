DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'Viewers read only (%' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS public.my_workspaces(), public.create_workspace(text), public.create_invite(uuid,public.app_role),
  public.revoke_invite(uuid), public.current_invite(uuid), public.invite_info(text), public.accept_invite(text),
  public.list_members(uuid), public.set_member_role(uuid,uuid,public.app_role), public.remove_member(uuid,uuid),
  public.is_tenant_admin(uuid), public.is_tenant_viewer(uuid);
DROP TABLE IF EXISTS public.tenant_invites;
-- Note: memberships created by invites stay in user_roles; remove them manually if a full revert is needed.
