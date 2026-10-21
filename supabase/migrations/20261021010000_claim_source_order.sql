-- Reading order of claims as the document states them. Nullable: existing rows have none.
ALTER TABLE public.extracted_claims ADD COLUMN IF NOT EXISTS source_seq integer;
