-- Additive foundation only. Apply to reviewed staging first. No demo rates or channel registrations.
-- Both ingestion and outbound remain OFF. Channel modes deliberately exclude LIVE.
BEGIN;
CREATE TABLE public.wa_channels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 phone_number_id text NOT NULL UNIQUE CHECK(phone_number_id ~ '^[0-9]{5,32}$'),
 display_label text NOT NULL CHECK(length(display_label) BETWEEN 1 AND 100),
 mode text NOT NULL DEFAULT 'DISABLED' CHECK(mode IN ('DISABLED','TEST')),
 ingest_enabled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,tenant_id)
);
CREATE TABLE public.wa_rate_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 created_by uuid NOT NULL REFERENCES auth.users(id),created_at timestamptz NOT NULL DEFAULT now(),
 source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 UNIQUE(id,tenant_id)
);
CREATE TABLE public.wa_quote_rates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id), batch_id uuid NOT NULL,
 version text NOT NULL CHECK(length(version) BETWEEN 1 AND 80),
 origin text NOT NULL CHECK(origin IN ('JHB','DBN','CPT','PTA')),destination text NOT NULL CHECK(destination IN ('JHB','DBN','CPT','PTA')),
 equipment text NOT NULL CHECK(equipment='TAUTLINER'),min_kg integer NOT NULL CHECK(min_kg>=1),max_kg integer NOT NULL CHECK(max_kg<=100000 AND max_kg>=min_kg),
 amount_minor bigint NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000), currency text NOT NULL CHECK(currency='ZAR'),
 vat_treatment text NOT NULL CHECK(vat_treatment IN ('INCLUDED','EXCLUDED','NOT_APPLICABLE')),vat_bps integer NOT NULL CHECK(vat_bps BETWEEN 0 AND 3000),
 valid_from timestamptz NOT NULL,valid_to timestamptz NOT NULL,validity_hours integer NOT NULL CHECK(validity_hours BETWEEN 1 AND 168),
 terms text NOT NULL CHECK(length(trim(terms)) BETWEEN 1 AND 2000),exclusions text NOT NULL CHECK(length(trim(exclusions)) BETWEEN 1 AND 2000),
 source_reference text NOT NULL CHECK(length(trim(source_reference)) BETWEEN 1 AND 2000),
 disclosure_approved boolean NOT NULL CHECK(disclosure_approved=true),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(batch_id,tenant_id) REFERENCES public.wa_rate_batches(id,tenant_id), CHECK(origin<>destination),CHECK(valid_to>valid_from),CHECK(vat_treatment<>'NOT_APPLICABLE' OR vat_bps=0), UNIQUE(id,tenant_id)
);
CREATE TABLE public.wa_rate_revocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),batch_id uuid NOT NULL,
 revoked_by uuid NOT NULL REFERENCES auth.users(id),revoked_at timestamptz NOT NULL DEFAULT now(),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 10 AND 2000),
 FOREIGN KEY(batch_id,tenant_id) REFERENCES public.wa_rate_batches(id,tenant_id),UNIQUE(batch_id)
);
CREATE INDEX wa_rate_lookup ON public.wa_quote_rates(tenant_id,origin,destination,equipment,valid_from,valid_to);
CREATE TABLE public.wa_quote_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),channel_id uuid NOT NULL,
 provider_message_id text NOT NULL CHECK(length(provider_message_id) BETWEEN 1 AND 256),
 sender_id text NOT NULL CHECK(sender_id ~ '^[0-9]{6,16}$'),provider_sent_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(),raw_text text NOT NULL CHECK(length(raw_text)<=4096),
 raw_sha256 text NOT NULL CHECK(raw_sha256 ~ '^[a-f0-9]{64}$'),
 UNIQUE(channel_id,provider_message_id),FOREIGN KEY(channel_id,tenant_id) REFERENCES public.wa_channels(id,tenant_id),UNIQUE(id,tenant_id)
);
CREATE TABLE public.wa_quote_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),request_id uuid NOT NULL,
 engine_version text NOT NULL,snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 draft_body text NOT NULL CHECK(length(draft_body)<=10000),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(request_id,tenant_id) REFERENCES public.wa_quote_requests(id,tenant_id),UNIQUE(request_id),UNIQUE(id,tenant_id)
);
CREATE TABLE public.wa_quote_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id),snapshot_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'DRAFT' CHECK(state='DRAFT'), -- sending is structurally impossible in foundation
 body text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(snapshot_id,tenant_id) REFERENCES public.wa_quote_snapshots(id,tenant_id),UNIQUE(snapshot_id)
);
CREATE OR REPLACE FUNCTION public.wa_is_admin(t uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE tenant_id=t AND user_id=auth.uid() AND role='admin')
$$;
REVOKE ALL ON FUNCTION public.wa_is_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wa_is_admin(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.wa_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'WA_APPEND_ONLY'; END $$;
CREATE OR REPLACE FUNCTION public.wa_guard_rate_overlap() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('wa-rates:'||NEW.tenant_id::text,0));
 IF EXISTS(SELECT 1 FROM wa_quote_rates r WHERE r.tenant_id=NEW.tenant_id AND NOT EXISTS(SELECT 1 FROM wa_rate_revocations v WHERE v.batch_id=r.batch_id) AND r.origin=NEW.origin AND r.destination=NEW.destination AND r.equipment=NEW.equipment AND greatest(r.min_kg,NEW.min_kg)<=least(r.max_kg,NEW.max_kg) AND greatest(r.valid_from,NEW.valid_from)<least(r.valid_to,NEW.valid_to)) THEN RAISE EXCEPTION 'WA_OVERLAPPING_RATE'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wa_rate_overlap BEFORE INSERT ON public.wa_quote_rates FOR EACH ROW EXECUTE FUNCTION public.wa_guard_rate_overlap();
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['wa_channels','wa_rate_batches','wa_rate_revocations','wa_quote_rates','wa_quote_requests','wa_quote_snapshots','wa_quote_outbox'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated,service_role',t);
 EXECUTE format('GRANT SELECT ON public.%I TO authenticated,service_role',t);
 EXECUTE format('CREATE POLICY admin_read ON public.%I FOR SELECT TO authenticated USING(public.wa_is_admin(tenant_id))',t);
 IF t<>'wa_channels' THEN EXECUTE format('CREATE TRIGGER wa_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.wa_immutable()',t); END IF;
 END LOOP;
END $$;
-- Atomic all-or-nothing import; only authenticated tenant admins. No direct rate inserts granted.
CREATE OR REPLACE FUNCTION public.wa_import_rates(p_tenant uuid,p_sha256 text,p_rates jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b uuid;r jsonb;
BEGIN
 IF NOT public.wa_is_admin(p_tenant) THEN RAISE EXCEPTION 'WA_ADMIN_REQUIRED'; END IF;
 IF p_rates IS NULL OR jsonb_typeof(p_rates)<>'array' OR jsonb_array_length(p_rates) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'WA_BAD_BATCH'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('wa-rates:'||p_tenant::text,0));
 INSERT INTO wa_rate_batches(tenant_id,created_by,source_sha256) VALUES(p_tenant,auth.uid(),p_sha256) RETURNING id INTO b;
 FOR r IN SELECT value FROM jsonb_array_elements(p_rates) LOOP
 INSERT INTO wa_quote_rates(tenant_id,batch_id,version,origin,destination,equipment,min_kg,max_kg,amount_minor,currency,vat_treatment,vat_bps,valid_from,valid_to,validity_hours,terms,exclusions,source_reference,disclosure_approved)
 VALUES(p_tenant,b,r->>'version',r->>'origin',r->>'destination',r->>'equipment',(r->>'minKg')::integer,(r->>'maxKg')::integer,(r->>'amountMinor')::bigint,r->>'currency',r->>'vatTreatment',(r->>'vatBps')::integer,(r->>'validFrom')::timestamptz,(r->>'validTo')::timestamptz,(r->>'validityHours')::integer,r->>'terms',r->>'exclusions',r->>'sourceReference',(r->>'disclosureApproved')::boolean);
 END LOOP;
 RETURN b;
END $$;
REVOKE ALL ON FUNCTION public.wa_import_rates(uuid,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.wa_import_rates(uuid,text,jsonb) TO authenticated;
-- Test ingestion only. Internal role restriction via EXECUTE; all duplicate paths return original request.
CREATE OR REPLACE FUNCTION public.wa_receive_test(p_channel uuid,p_message text,p_sender text,p_sent timestamptz,p_text text,p_sha text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE c wa_channels;req uuid;
BEGIN
 SELECT * INTO c FROM wa_channels WHERE id=p_channel FOR UPDATE;
 IF c.id IS NULL OR c.mode<>'TEST' OR NOT c.ingest_enabled THEN RAISE EXCEPTION 'WA_TEST_CHANNEL_REQUIRED'; END IF;
 SELECT id INTO req FROM wa_quote_requests WHERE channel_id=p_channel AND provider_message_id=p_message;
 IF req IS NOT NULL THEN RETURN req; END IF;
 IF p_sent>now()+interval '5 minutes' OR p_sent<now()-interval '24 hours' THEN RAISE EXCEPTION 'WA_STALE_MESSAGE'; END IF;
 IF (SELECT count(*) FROM wa_quote_requests WHERE channel_id=p_channel AND received_at>now()-interval '1 minute')>=60 THEN RAISE EXCEPTION 'WA_CHANNEL_THROTTLED'; END IF;
 IF (SELECT count(*) FROM wa_quote_requests WHERE channel_id=p_channel AND sender_id=p_sender AND received_at>now()-interval '1 hour')>=10 THEN RAISE EXCEPTION 'WA_SENDER_THROTTLED'; END IF;
 INSERT INTO wa_quote_requests(tenant_id,channel_id,provider_message_id,sender_id,provider_sent_at,raw_text,raw_sha256) VALUES(c.tenant_id,p_channel,p_message,p_sender,p_sent,p_text,p_sha) RETURNING id INTO req;
 RETURN req;
END $$;
REVOKE ALL ON FUNCTION public.wa_receive_test(uuid,text,text,timestamptz,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_receive_test(uuid,text,text,timestamptz,text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.wa_save_test_snapshot(p_request uuid,p_engine text,p_snapshot jsonb,p_draft text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE req wa_quote_requests;c wa_channels;q uuid;
BEGIN
 SELECT * INTO req FROM wa_quote_requests WHERE id=p_request FOR UPDATE;
 SELECT * INTO c FROM wa_channels WHERE id=req.channel_id;
 IF req.id IS NULL OR c.mode<>'TEST' OR NOT c.ingest_enabled THEN RAISE EXCEPTION 'WA_TEST_CHANNEL_REQUIRED'; END IF;
 SELECT id INTO q FROM wa_quote_snapshots WHERE request_id=p_request;
 IF q IS NOT NULL THEN RETURN q; END IF;
 INSERT INTO wa_quote_snapshots(tenant_id,request_id,engine_version,snapshot,draft_body) VALUES(req.tenant_id,req.id,p_engine,p_snapshot,p_draft) RETURNING id INTO q;
 -- No outbox or external-send record is created by test ingestion.
 RETURN q;
END $$;
REVOKE ALL ON FUNCTION public.wa_save_test_snapshot(uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_save_test_snapshot(uuid,text,jsonb,text) TO service_role;
CREATE OR REPLACE FUNCTION public.wa_revoke_rate_batch(p_tenant uuid,p_batch uuid,p_reason text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v uuid;
BEGIN
 IF NOT public.wa_is_admin(p_tenant) THEN RAISE EXCEPTION 'WA_ADMIN_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('wa-rates:'||p_tenant::text,0));
 INSERT INTO wa_rate_revocations(tenant_id,batch_id,revoked_by,reason) VALUES(p_tenant,p_batch,auth.uid(),p_reason) RETURNING id INTO v;
 RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.wa_revoke_rate_batch(uuid,uuid,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.wa_revoke_rate_batch(uuid,uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.wa_current_rate_rows(p_tenant uuid) RETURNS SETOF public.wa_quote_rates LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public AS $$
 SELECT r.* FROM wa_quote_rates r WHERE r.tenant_id=p_tenant AND NOT EXISTS(SELECT 1 FROM wa_rate_revocations v WHERE v.batch_id=r.batch_id) ORDER BY r.created_at DESC LIMIT 501
$$;
REVOKE ALL ON FUNCTION public.wa_current_rate_rows(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.wa_current_rate_rows(uuid) TO authenticated,service_role;
COMMIT;
