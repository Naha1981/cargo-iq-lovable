-- Bound app_errors text (audit item 13 partial): the insert policy lets any
-- authenticated user write arbitrary-length text. Cap new rows at the lengths
-- the client already sends (message 2000, stack 4000) plus headroom for route
-- and source. NOT VALID so existing rows are never scanned or rejected;
-- applies to new rows immediately. Oversized client inserts fail harmlessly:
-- the reporting path is best-effort and swallows errors by design.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='30s';
DO $bounds$
BEGIN
  IF to_regclass('public.app_errors') IS NULL THEN
    RAISE EXCEPTION 'app_errors missing - not the expected CargoIQ schema';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.app_errors'::regclass AND conname='app_errors_message_len') THEN
    ALTER TABLE public.app_errors ADD CONSTRAINT app_errors_message_len CHECK (char_length(message) <= 4000) NOT VALID;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.app_errors'::regclass AND conname='app_errors_stack_len') THEN
    ALTER TABLE public.app_errors ADD CONSTRAINT app_errors_stack_len CHECK (stack IS NULL OR char_length(stack) <= 8000) NOT VALID;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.app_errors'::regclass AND conname='app_errors_route_len') THEN
    ALTER TABLE public.app_errors ADD CONSTRAINT app_errors_route_len CHECK (route IS NULL OR char_length(route) <= 500) NOT VALID;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.app_errors'::regclass AND conname='app_errors_source_len') THEN
    ALTER TABLE public.app_errors ADD CONSTRAINT app_errors_source_len CHECK (source IS NULL OR char_length(source) <= 100) NOT VALID;
  END IF;
END $bounds$;
COMMIT;
SELECT 'app_errors_bounds_applied' AS result,
 (SELECT count(*) FROM pg_constraint WHERE conrelid='public.app_errors'::regclass AND conname LIKE 'app_errors_%_len')=4 AS bounds;
