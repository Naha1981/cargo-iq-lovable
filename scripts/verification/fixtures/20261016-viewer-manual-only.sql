-- Synthetic acceptance fixture only. No real member or original demo access.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='30s';
DO $fixture$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tenants WHERE id='8f4a57ab-44f8-48f4-a043-444e7b41a694' AND name='SYNTHETIC QA 16Oct isolated acceptance tenant') THEN RAISE EXCEPTION 'Synthetic tenant identity mismatch'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id='ebc8e30e-534d-4202-9ae0-6cb2789e7972' AND email='cargoiq-viewer-qa-20261016-31f8bdb95b@example.invalid') THEN RAISE EXCEPTION 'Synthetic auth identity mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.user_roles WHERE user_id='ebc8e30e-534d-4202-9ae0-6cb2789e7972') THEN RAISE EXCEPTION 'Fixture already assigned or identity drift; inspect instead of widening access'; END IF;
 INSERT INTO public.user_roles(user_id,tenant_id,role) VALUES('ebc8e30e-534d-4202-9ae0-6cb2789e7972','8f4a57ab-44f8-48f4-a043-444e7b41a694','viewer');
END $fixture$;
COMMIT;
SELECT 'synthetic_viewer_fixture_ready' AS result,role::text='viewer' AS read_only_role FROM public.user_roles WHERE user_id='ebc8e30e-534d-4202-9ae0-6cb2789e7972' AND tenant_id='8f4a57ab-44f8-48f4-a043-444e7b41a694';
