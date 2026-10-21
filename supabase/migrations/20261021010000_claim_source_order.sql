-- Reading order of claims as the document states them. Nullable: existing rows have none.
ALTER TABLE public.extracted_claims ADD COLUMN IF NOT EXISTS source_seq integer;
-- Review checklist (Supabase Data API change, effective 30 Oct 2026 for existing projects, per
-- https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically):
-- this migration only adds a column to an existing table, so existing grants and RLS apply unchanged.
-- Any NEW public table in later migrations needs explicit, least-privilege Data API grants plus RLS,
-- grounded separately. A missing grant returns 42501 over REST. Do not add broad grants here.
