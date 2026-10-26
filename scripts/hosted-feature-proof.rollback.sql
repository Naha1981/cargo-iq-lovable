\set ON_ERROR_STOP on
BEGIN;
SET LOCAL statement_timeout='15s';
INSERT INTO auth.users(id) VALUES ('af000000-0000-4000-8000-000000000001'),('af000000-0000-4000-8000-000000000002'),('af000000-0000-4000-8000-000000000003');
INSERT INTO public.tenants(id,name) VALUES ('bf000000-0000-4000-8000-000000000001','SYNTHETIC feature proof A'),('bf000000-0000-4000-8000-000000000002','SYNTHETIC feature proof B');
INSERT INTO public.user_roles(user_id,tenant_id,role) VALUES ('af000000-0000-4000-8000-000000000001','bf000000-0000-4000-8000-000000000001','investigator'),('af000000-0000-4000-8000-000000000002','bf000000-0000-4000-8000-000000000001','viewer'),('af000000-0000-4000-8000-000000000003','bf000000-0000-4000-8000-000000000002','investigator');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','af000000-0000-4000-8000-000000000001',true);
INSERT INTO public.recovery_findings(id,tenant_id,finding_type,title,created_by) VALUES ('cf000000-0000-4000-8000-000000000001','bf000000-0000-4000-8000-000000000001','missed_billing','SYNTHETIC rollback-only proof','af000000-0000-4000-8000-000000000001');
DO $$ BEGIN
 IF (SELECT count(*) FROM public.recovery_finding_events WHERE finding_id='cf000000-0000-4000-8000-000000000001' AND actor=auth.uid()) <> 1 THEN RAISE EXCEPTION 'AUDIT_INSERT_FAILED'; END IF;
 BEGIN
  UPDATE public.recovery_findings SET status='recovered' WHERE id='cf000000-0000-4000-8000-000000000001';
  RAISE EXCEPTION 'INVALID_TRANSITION_ACCEPTED';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%INVALID_RECOVERY_TRANSITION%' THEN RAISE; END IF; END;
 IF (SELECT status FROM public.recovery_findings WHERE id='cf000000-0000-4000-8000-000000000001') <> 'new' THEN RAISE EXCEPTION 'ROLLBACK_FAILED'; END IF;
 BEGIN
  INSERT INTO public.recovery_finding_events(tenant_id,finding_id,action,actor) VALUES ('bf000000-0000-4000-8000-000000000001','cf000000-0000-4000-8000-000000000001','created',auth.uid());
  RAISE EXCEPTION 'AUDIT_SPOOF_ACCEPTED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RAISE NOTICE 'PASS actor-bound audit, invalid transition atomic rollback, direct audit insert refused';
END $$;
UPDATE public.recovery_findings SET status='under_review' WHERE id='cf000000-0000-4000-8000-000000000001';

DO $$ DECLARE rows jsonb := '[{"finding_type":"missed_billing","title":"SYNTHETIC batch","currency":"ZAR","calculation":{},"source_document_ids":[],"evidence_refs":[]}]'::jsonb; a uuid; b uuid; BEGIN
 SELECT id INTO a FROM public.cargoiq_create_recovery_batch('bf000000-0000-4000-8000-000000000001','df000000-0000-4000-8000-000000000001',rows);
 SELECT id INTO b FROM public.cargoiq_create_recovery_batch('bf000000-0000-4000-8000-000000000001','df000000-0000-4000-8000-000000000001',rows);
 IF a IS NULL OR a IS DISTINCT FROM b THEN RAISE EXCEPTION 'REPLAY_NOT_IDENTICAL'; END IF;
 IF (SELECT count(*) FROM public.recovery_finding_events WHERE finding_id=a) <> 1 THEN RAISE EXCEPTION 'REPLAY_DUPLICATE_AUDIT'; END IF;
 BEGIN
  PERFORM * FROM public.cargoiq_create_recovery_batch('bf000000-0000-4000-8000-000000000001','df000000-0000-4000-8000-000000000001',jsonb_set(rows,'{0,title}','"different"'));
  RAISE EXCEPTION 'REUSED_KEY_ACCEPTED';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%REQUEST_KEY_REUSED_WITH_DIFFERENT_INPUT%' THEN RAISE; END IF; END;
 BEGIN
  PERFORM * FROM public.cargoiq_create_recovery_batch('bf000000-0000-4000-8000-000000000001','df000000-0000-4000-8000-000000000002',rows || '[{"finding_type":"INVALID","title":"bad","currency":"ZAR"}]'::jsonb);
  RAISE EXCEPTION 'BAD_BATCH_ACCEPTED';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.recovery_findings WHERE calculation->>'request_id'='df000000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'PARTIAL_BATCH_SAVED'; END IF;
 RAISE NOTICE 'PASS replay IDs/no duplicate audit, changed-payload refusal, whole-batch rollback';
END $$;
INSERT INTO public.scene_assets(tenant_id,name,source_type,created_by) VALUES ('bf000000-0000-4000-8000-000000000001','SYNTHETIC scene','ply',auth.uid());
INSERT INTO public.geospatial_findings(tenant_id,title,source,method,created_by) VALUES ('bf000000-0000-4000-8000-000000000001','SYNTHETIC finding','fixture','manual',auth.uid());
INSERT INTO public.simulation_scenarios(tenant_id,name,scenario_type,created_by) VALUES ('bf000000-0000-4000-8000-000000000001','SYNTHETIC scenario','other',auth.uid());
DO $$ BEGIN
 IF (SELECT count(*) FROM public.scene_asset_events WHERE tenant_id='bf000000-0000-4000-8000-000000000001') <> 1 OR (SELECT count(*) FROM public.geospatial_finding_events WHERE tenant_id='bf000000-0000-4000-8000-000000000001') <> 1 OR (SELECT count(*) FROM public.simulation_scenario_events WHERE tenant_id='bf000000-0000-4000-8000-000000000001') <> 1 THEN RAISE EXCEPTION 'OTHER_AUDITS_MISSING'; END IF;
 RAISE NOTICE 'PASS scene/geospatial/scenario automatic audits';
END $$;

SELECT set_config('request.jwt.claim.sub','af000000-0000-4000-8000-000000000002',true);
DO $$ DECLARE n int; BEGIN
 IF (SELECT count(*) FROM public.recovery_findings WHERE id='cf000000-0000-4000-8000-000000000001') <> 1 THEN RAISE EXCEPTION 'VIEWER_READ_FAILED'; END IF;
 UPDATE public.recovery_findings SET title='tamper' WHERE id='cf000000-0000-4000-8000-000000000001'; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'VIEWER_WRITE_ACCEPTED'; END IF;
 RAISE NOTICE 'PASS viewer read/no write';
END $$;
SELECT set_config('request.jwt.claim.sub','af000000-0000-4000-8000-000000000003',true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.recovery_findings WHERE id='cf000000-0000-4000-8000-000000000001') OR EXISTS(SELECT 1 FROM public.recovery_finding_events WHERE finding_id='cf000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'CROSS_TENANT_LEAK'; END IF;
 RAISE NOTICE 'PASS foreign tenant entity+audit isolation';
END $$;
ROLLBACK;
