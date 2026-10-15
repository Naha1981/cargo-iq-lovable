-- Separate from case/tenant permissions. Never changes cases/documents/storage RLS.
CREATE TABLE public.cuf_workspaces(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL CHECK(length(trim(name)) BETWEEN 3 AND 200),owner_id uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.cuf_members(workspace_id uuid NOT NULL REFERENCES public.cuf_workspaces(id),user_id uuid NOT NULL REFERENCES auth.users(id),party_name text NOT NULL CHECK(length(trim(party_name)) BETWEEN 2 AND 200),verified_email text NOT NULL,status text NOT NULL CHECK(status IN ('PENDING','ACTIVE','REVOKED')),PRIMARY KEY(workspace_id,user_id));
CREATE TABLE public.cuf_contributions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES public.cuf_workspaces(id),author_id uuid NOT NULL REFERENCES auth.users(id),payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.cuf_field_grants(contribution_id uuid NOT NULL REFERENCES public.cuf_contributions(id),recipient_id uuid NOT NULL REFERENCES auth.users(id),fields text[] NOT NULL,granted_by uuid NOT NULL REFERENCES auth.users(id),granted_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(contribution_id,recipient_id));
CREATE TABLE public.cuf_share_audit(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),workspace_id uuid NOT NULL REFERENCES public.cuf_workspaces(id),actor_id uuid NOT NULL REFERENCES auth.users(id),action text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.cuf_workspaces ENABLE ROW LEVEL SECURITY;ALTER TABLE public.cuf_members ENABLE ROW LEVEL SECURITY;ALTER TABLE public.cuf_contributions ENABLE ROW LEVEL SECURITY;ALTER TABLE public.cuf_field_grants ENABLE ROW LEVEL SECURITY;ALTER TABLE public.cuf_share_audit ENABLE ROW LEVEL SECURITY;
-- No client table writes. Reviewed RPCs own writes and audit in one transaction.
REVOKE ALL ON public.cuf_workspaces,public.cuf_members,public.cuf_contributions,public.cuf_field_grants,public.cuf_share_audit FROM anon,authenticated;
GRANT SELECT ON public.cuf_workspaces,public.cuf_members,public.cuf_contributions,public.cuf_field_grants,public.cuf_share_audit TO authenticated;
CREATE OR REPLACE FUNCTION public.cuf_active(w uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.cuf_members WHERE workspace_id=w AND user_id=auth.uid() AND status='ACTIVE') $$;
REVOKE ALL ON FUNCTION public.cuf_active(uuid) FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.cuf_active(uuid) TO authenticated;
CREATE POLICY "Own or joined workspace" ON public.cuf_workspaces FOR SELECT TO authenticated USING(owner_id=auth.uid() OR public.cuf_active(id));
-- Every member sees recipient verified emails because membership explicitly warns of roster disclosure.
CREATE POLICY "Own request or active roster" ON public.cuf_members FOR SELECT TO authenticated USING(user_id=auth.uid() OR EXISTS(SELECT 1 FROM public.cuf_workspaces WHERE id=workspace_id AND owner_id=auth.uid()) OR (status='ACTIVE' AND public.cuf_active(workspace_id)));
CREATE POLICY "Private original contribution" ON public.cuf_contributions FOR SELECT TO authenticated USING(author_id=auth.uid() AND public.cuf_active(workspace_id));
CREATE POLICY "Author grants only" ON public.cuf_field_grants FOR SELECT TO authenticated USING(granted_by=auth.uid());
CREATE POLICY "Actor audit only" ON public.cuf_share_audit FOR SELECT TO authenticated USING(actor_id=auth.uid());
CREATE OR REPLACE FUNCTION public.cuf_create(n text,p text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w uuid;e text;
BEGIN
 SELECT email INTO e FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL;
 IF e IS NULL OR length(trim(n)) NOT BETWEEN 3 AND 200 OR length(trim(p)) NOT BETWEEN 2 AND 200 THEN RAISE EXCEPTION 'Verified account and workspace/party names required'; END IF;
 INSERT INTO public.cuf_workspaces(name,owner_id) VALUES(trim(n),auth.uid()) RETURNING id INTO w;
 INSERT INTO public.cuf_members VALUES(w,auth.uid(),trim(p),e,'ACTIVE');
 INSERT INTO public.cuf_share_audit(workspace_id,actor_id,action,payload) VALUES(w,auth.uid(),'WORKSPACE_CREATED',jsonb_build_object('name',n));RETURN w;
END $$;
CREATE OR REPLACE FUNCTION public.cuf_request_join(w uuid,p text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e text;
BEGIN
 SELECT email INTO e FROM auth.users WHERE id=auth.uid() AND email_confirmed_at IS NOT NULL;
 IF e IS NULL OR length(trim(p)) NOT BETWEEN 2 AND 200 OR NOT EXISTS(SELECT 1 FROM public.cuf_workspaces WHERE id=w) THEN RAISE EXCEPTION 'Unable to request membership'; END IF;
 INSERT INTO public.cuf_members VALUES(w,auth.uid(),trim(p),e,'PENDING') ON CONFLICT(workspace_id,user_id) DO NOTHING;
 INSERT INTO public.cuf_share_audit(workspace_id,actor_id,action,payload) VALUES(w,auth.uid(),'MEMBERSHIP_REQUESTED',jsonb_build_object('roster_disclosure','verified email and claimed party visible to workspace members after acceptance'));
END $$;
CREATE OR REPLACE FUNCTION public.cuf_set_member(w uuid,u uuid,s text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.cuf_workspaces WHERE id=w AND owner_id=auth.uid()) OR s NOT IN ('ACTIVE','REVOKED') THEN RAISE EXCEPTION 'Workspace owner required'; END IF;
 IF u=auth.uid() THEN RAISE EXCEPTION 'Cannot revoke workspace owner'; END IF;
 UPDATE public.cuf_members SET status=s WHERE workspace_id=w AND user_id=u;IF NOT FOUND THEN RAISE EXCEPTION 'Member request missing'; END IF;
 IF s='REVOKED' THEN
  DELETE FROM public.cuf_field_grants WHERE contribution_id IN(SELECT id FROM public.cuf_contributions WHERE workspace_id=w) AND (recipient_id=u OR contribution_id IN(SELECT id FROM public.cuf_contributions WHERE workspace_id=w AND author_id=u));
 END IF;
 INSERT INTO public.cuf_share_audit(workspace_id,actor_id,action,payload) VALUES(w,auth.uid(),'MEMBER_STATUS_SET',jsonb_build_object('user_id',u,'status',s));
END $$;
CREATE OR REPLACE FUNCTION public.cuf_add_contribution(w uuid,p jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c uuid;k text;
BEGIN
 IF NOT public.cuf_active(w) OR jsonb_typeof(p)<>'object' OR pg_column_size(p)>16000 THEN RAISE EXCEPTION 'Active member and bounded evidence object required'; END IF;
 FOR k IN SELECT jsonb_object_keys(p) LOOP IF k NOT IN ('event_reference','event_type','timestamp','count','unit','source_excerpt','source_reference','limitations') OR jsonb_typeof(p->k)<>'string' THEN RAISE EXCEPTION 'Unsupported evidence field'; END IF;END LOOP;
 IF length(trim(coalesce(p->>'event_reference','')))<3 OR length(trim(coalesce(p->>'source_reference','')))<3 OR length(trim(coalesce(p->>'limitations','')))<3 THEN RAISE EXCEPTION 'Event, source reference and limitations required'; END IF;
 INSERT INTO public.cuf_contributions(workspace_id,author_id,payload) VALUES(w,auth.uid(),p) RETURNING id INTO c;
 INSERT INTO public.cuf_share_audit(workspace_id,actor_id,action,payload) VALUES(w,auth.uid(),'PRIVATE_CONTRIBUTION_CREATED',jsonb_build_object('contribution_id',c));RETURN c;
END $$;
CREATE OR REPLACE FUNCTION public.cuf_grant(c uuid,u uuid,f text[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w uuid;k text;projected jsonb;
BEGIN
 SELECT workspace_id INTO w FROM public.cuf_contributions WHERE id=c AND author_id=auth.uid();
 IF w IS NULL OR NOT public.cuf_active(w) OR NOT EXISTS(SELECT 1 FROM public.cuf_members WHERE workspace_id=w AND user_id=u AND status='ACTIVE') OR u=auth.uid() THEN RAISE EXCEPTION 'Author and active recipient required'; END IF;
 IF f IS NULL OR cardinality(f)<1 OR cardinality(f)>8 THEN RAISE EXCEPTION 'Select explicit fields'; END IF;
 FOREACH k IN ARRAY f LOOP IF k IS NULL OR k NOT IN ('event_reference','event_type','timestamp','count','unit','source_excerpt','source_reference','limitations') THEN RAISE EXCEPTION 'Unsupported field grant'; END IF;END LOOP;
 SELECT coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb) INTO projected FROM public.cuf_contributions x,LATERAL jsonb_each(x.payload) e WHERE x.id=c AND e.key=ANY(f);
 INSERT INTO public.cuf_field_grants(contribution_id,recipient_id,fields,granted_by) VALUES(c,u,f,auth.uid()) ON CONFLICT(contribution_id,recipient_id) DO UPDATE SET fields=excluded.fields,granted_at=now(),granted_by=auth.uid();
 INSERT INTO public.cuf_share_audit(workspace_id,actor_id,action,payload) VALUES(w,auth.uid(),'FIELD_GRANT_SET',jsonb_build_object('contribution_id',c,'recipient_id',u,'fields',f,'disclosed_values',projected));
END $$;
CREATE OR REPLACE FUNCTION public.cuf_revoke(c uuid,u uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w uuid;
BEGIN
 SELECT workspace_id INTO w FROM public.cuf_contributions WHERE id=c AND author_id=auth.uid();IF w IS NULL OR NOT public.cuf_active(w) THEN RAISE EXCEPTION 'Active author required'; END IF;
 DELETE FROM public.cuf_field_grants WHERE contribution_id=c AND recipient_id=u;
 INSERT INTO public.cuf_share_audit(workspace_id,actor_id,action,payload) VALUES(w,auth.uid(),'FIELD_GRANT_REVOKED',jsonb_build_object('contribution_id',c,'recipient_id',u));
END $$;
CREATE OR REPLACE FUNCTION public.cuf_read_shared(w uuid) RETURNS TABLE(contribution_id uuid,source_party text,shared_fields jsonb) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT c.id,m.party_name,coalesce(jsonb_object_agg(e.key,e.value) FILTER(WHERE e.key=ANY(g.fields)),'{}'::jsonb)
 FROM public.cuf_contributions c JOIN public.cuf_field_grants g ON g.contribution_id=c.id
 JOIN public.cuf_members m ON m.workspace_id=c.workspace_id AND m.user_id=c.author_id AND m.status='ACTIVE'
 LEFT JOIN LATERAL jsonb_each(c.payload) e ON true
 WHERE c.workspace_id=w AND g.recipient_id=auth.uid() AND public.cuf_active(w)
 GROUP BY c.id,m.party_name
$$;
REVOKE ALL ON FUNCTION public.cuf_create(text,text),public.cuf_request_join(uuid,text),public.cuf_set_member(uuid,uuid,text),public.cuf_add_contribution(uuid,jsonb),public.cuf_grant(uuid,uuid,text[]),public.cuf_revoke(uuid,uuid),public.cuf_read_shared(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cuf_create(text,text),public.cuf_request_join(uuid,text),public.cuf_set_member(uuid,uuid,text),public.cuf_add_contribution(uuid,jsonb),public.cuf_grant(uuid,uuid,text[]),public.cuf_revoke(uuid,uuid),public.cuf_read_shared(uuid) TO authenticated;
