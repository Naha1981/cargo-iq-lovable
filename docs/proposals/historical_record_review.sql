-- PROPOSAL ONLY. Never auto-apply. Requires target catalog/backup review and approval.
-- Adding functions/triggers changes the catalog. Requalify combined readiness.
BEGIN;
CREATE FUNCTION public.derive_historical_record_review() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE t uuid; actor uuid := auth.uid(); records jsonb; reviewed timestamptz := transaction_timestamp(); body jsonb; limits text; p_case_id uuid := NEW.case_id; p_date date; p_place text; p_lat double precision; p_lon double precision;
BEGIN
 IF NEW.observation_type <> 'HISTORICAL_RECORD_REVIEW' THEN RETURN NEW; END IF;
 IF public.cargoiq_historical_review_readiness()->>'ready' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'HISTORICAL_REVIEW_NOT_ACTIVATED'; END IF;
 SELECT c.tenant_id INTO t FROM public.cases c JOIN public.user_roles r ON r.tenant_id=c.tenant_id AND r.user_id=actor AND r.role IN ('admin','investigator') WHERE c.id=p_case_id;
 IF t IS NULL OR NEW.tenant_id IS DISTINCT FROM t THEN RAISE EXCEPTION 'CASE_NOT_FOUND_OR_INVESTIGATOR_REQUIRED'; END IF;
 p_date := (NEW.payload->>'selectedDate')::date; p_place := NEW.payload->>'candidatePlace'; p_lat := (NEW.payload->>'referenceLatitude')::double precision; p_lon := (NEW.payload->>'referenceLongitude')::double precision;
 IF (NEW.payload->>'confirmed')::boolean IS DISTINCT FROM true OR p_date IS NULL OR p_place IS NULL OR length(trim(p_place)) NOT BETWEEN 1 AND 160 OR p_lat IS NULL OR p_lon IS NULL OR NOT (p_lat BETWEEN -90 AND 90) OR NOT (p_lon BETWEEN -180 AND 180) THEN RAISE EXCEPTION 'REVIEW_CONFIRMATION_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('case-evidence:'||p_case_id::text,0));
 SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) INTO records FROM (
  SELECT e.id,e.title,e.timestamp,e.nature,e.source,e.coordinates,e.provenance_id FROM public.timeline_events e
  WHERE e.case_id=p_case_id AND e.tenant_id=t AND (e.timestamp AT TIME ZONE 'Africa/Johannesburg')::date=p_date
  AND jsonb_typeof(coalesce(e.coordinates->'lat',e.coordinates->'latitude'))='number'
  AND jsonb_typeof(coalesce(e.coordinates->'lon',e.coordinates->'longitude'))='number'
  AND CASE WHEN jsonb_typeof(coalesce(e.coordinates->'lat',e.coordinates->'latitude'))='number' AND jsonb_typeof(coalesce(e.coordinates->'lon',e.coordinates->'longitude'))='number'
    THEN (coalesce(e.coordinates->>'lat',e.coordinates->>'latitude'))::double precision BETWEEN -90 AND 90
     AND (coalesce(e.coordinates->>'lon',e.coordinates->>'longitude'))::double precision BETWEEN -180 AND 180
     AND sqrt(power(((coalesce(e.coordinates->>'lat',e.coordinates->>'latitude'))::double precision-p_lat)*111.2,2)+power(((coalesce(e.coordinates->>'lon',e.coordinates->>'longitude'))::double precision-p_lon)*111.2*cos(radians(p_lat)),2))<=2
    ELSE false END
 ) r;
 IF jsonb_array_length(records)>3000 THEN RAISE EXCEPTION 'REVIEW_TOO_LARGE'; END IF;
 limits := 'Operator-reviewed reference place and South African date filter, not independent sensor evidence. Nearby recorded coordinates do not establish terminal or vessel identity, historical imagery coverage, exposure or causation. Record timestamps are as filed, not independently verified. No matching record does not prove no event occurred. Basemap pixels and live markers are not included.';
 body := jsonb_build_object('reviewVersion','1','selectedDate',p_date,'timezone','Africa/Johannesburg','candidatePlace',trim(p_place),'radiusKm',2,'referenceLatitude',p_lat,'referenceLongitude',p_lon,'reviewedBy',actor,'reviewedAt',reviewed,'confirmed',true,'basemapIsHistorical',false,'terminalIdentityVerified',false,'records',records,'limitations',limits);
 NEW.payload := body; NEW.source := 'CargoIQ historical record review'; NEW.observed_at := reviewed; NEW.latitude := NULL; NEW.longitude := NULL; NEW.confidence := NULL; NEW.limitation := limits;
 RETURN NEW;
END $$;
CREATE TRIGGER b_historical_review_derive BEFORE INSERT ON public.external_observations FOR EACH ROW EXECUTE FUNCTION public.derive_historical_record_review();
CREATE FUNCTION public.audit_historical_record_review() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF NEW.observation_type='HISTORICAL_RECORD_REVIEW' THEN
 INSERT INTO public.audit_log(tenant_id,case_id,actor_user_id,action,entity_type,entity_id,payload) VALUES(NEW.tenant_id,NEW.case_id,auth.uid(),'HISTORICAL_RECORD_REVIEW_SAVED','external_observations',NEW.id,NEW.payload);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER historical_review_audit AFTER INSERT ON public.external_observations FOR EACH ROW EXECUTE FUNCTION public.audit_historical_record_review();
REVOKE ALL ON FUNCTION public.derive_historical_record_review(),public.audit_historical_record_review() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.save_historical_record_review(p_case_id uuid,p_request_id uuid,p_date date,p_place text,p_lat double precision,p_lon double precision,p_confirmed boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE t uuid; actor uuid := auth.uid(); records jsonb; oid uuid; reviewed timestamptz := transaction_timestamp(); body jsonb; limits text; prior public.external_observations;
BEGIN
 SELECT c.tenant_id INTO t FROM public.cases c JOIN public.user_roles r ON r.tenant_id=c.tenant_id AND r.user_id=actor AND r.role IN ('admin','investigator') WHERE c.id=p_case_id;
 IF t IS NULL THEN RAISE EXCEPTION 'CASE_NOT_FOUND_OR_INVESTIGATOR_REQUIRED'; END IF;
 IF p_request_id IS NULL OR p_confirmed IS DISTINCT FROM true OR p_date IS NULL OR p_place IS NULL OR length(trim(p_place)) NOT BETWEEN 1 AND 160 OR p_lat IS NULL OR p_lon IS NULL OR NOT (p_lat BETWEEN -90 AND 90) OR NOT (p_lon BETWEEN -180 AND 180) THEN RAISE EXCEPTION 'REVIEW_CONFIRMATION_REQUIRED'; END IF;
 -- Same case lock as core pack generation and timeline writes. Match set and
 -- embedded source bytes are derived under that lock, never from postMessage.
 PERFORM pg_advisory_xact_lock(hashtextextended('case-evidence:'||p_case_id::text,0));
 SELECT * INTO prior FROM public.external_observations WHERE id=p_request_id;
 IF FOUND THEN
  IF prior.tenant_id=t AND prior.case_id=p_case_id AND prior.observation_type='HISTORICAL_RECORD_REVIEW' AND prior.payload->>'reviewedBy'=actor::text AND prior.payload->>'selectedDate'=p_date::text AND prior.payload->>'candidatePlace'=trim(p_place) AND (prior.payload->>'referenceLatitude')::double precision=p_lat AND (prior.payload->>'referenceLongitude')::double precision=p_lon THEN
   RETURN jsonb_build_object('observationId',prior.id,'recordCount',jsonb_array_length(prior.payload->'records'));
  END IF;
  RAISE EXCEPTION 'REVIEW_REQUEST_CONFLICT';
 END IF;
 INSERT INTO public.external_observations(id,tenant_id,case_id,source,observation_type,observed_at,payload)
 VALUES(p_request_id,t,p_case_id,'CargoIQ historical record review','HISTORICAL_RECORD_REVIEW',reviewed,jsonb_build_object('selectedDate',p_date,'candidatePlace',p_place,'referenceLatitude',p_lat,'referenceLongitude',p_lon,'confirmed',p_confirmed)) RETURNING id,payload INTO oid,body;
 records := body->'records';
 RETURN jsonb_build_object('observationId',oid,'recordCount',jsonb_array_length(records));
END $$;
REVOKE ALL ON FUNCTION public.save_historical_record_review(uuid,uuid,date,text,double precision,double precision,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_historical_record_review(uuid,uuid,date,text,double precision,double precision,boolean) TO authenticated;
CREATE FUNCTION public.cargoiq_historical_review_readiness() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE fingerprint text;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid()) THEN RAISE EXCEPTION 'MEMBERSHIP_REQUIRED'; END IF;
 select md5(jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('save_historical_record_review','derive_historical_record_review','audit_historical_record_review','lock_pack_source_case','guard_evidence_immutable','guard_case_tenant_match','guard_audit_actor')),
 'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'triggers',(select jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) order by t.tgname) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),'policies',(select jsonb_agg(jsonb_build_object('name',p.polname,'cmd',p.polcmd,'permissive',p.polpermissive,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid),'roles',(select array_agg(r.rolname order by r.rolname) from pg_roles r where r.oid=any(p.polroles))) order by p.polname) from pg_policy p where p.polrelid=c.oid)) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('external_observations','timeline_events','audit_log','cases','user_roles'))
)::text) INTO fingerprint;
 RETURN jsonb_build_object('ready',fingerprint='8792dbda9eaaae95aa4b713aa0dddfb8');
END $$;
REVOKE ALL ON FUNCTION public.cargoiq_historical_review_readiness() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cargoiq_historical_review_readiness() TO authenticated;
COMMIT;
