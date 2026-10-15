-- Existing resolution_note is present in the core schema. Add provenance without
-- rewriting legacy resolutions or making unsupported claims about old evidence.
ALTER TABLE public.contradictions ADD COLUMN IF NOT EXISTS resolution_note text;
ALTER TABLE public.contradictions ADD COLUMN IF NOT EXISTS resolution_document_id uuid REFERENCES public.documents(id) ON DELETE RESTRICT;
ALTER TABLE public.contradictions ADD COLUMN IF NOT EXISTS resolution_evidence_reference text;

CREATE OR REPLACE FUNCTION public.guard_evidenced_resolution()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'RESOLVED' AND OLD.status IS DISTINCT FROM 'RESOLVED' THEN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authenticated investigator required'; END IF;
    IF length(trim(coalesce(NEW.resolution_note,''))) < 10
      OR length(trim(coalesce(NEW.resolution_note,''))) > 4000
      OR length(trim(coalesce(NEW.resolution_evidence_reference,''))) < 3
      OR length(trim(coalesce(NEW.resolution_evidence_reference,''))) > 1000 THEN
      RAISE EXCEPTION 'Resolution needs an explanation and a supporting evidence reference';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.documents d WHERE d.id = NEW.resolution_document_id
      AND d.case_id = NEW.case_id AND d.tenant_id = NEW.tenant_id) THEN
      RAISE EXCEPTION 'Supporting document must belong to this case and tenant';
    END IF;
    NEW.resolved_by := auth.uid();
    NEW.resolved_at := now();
    INSERT INTO public.audit_log(tenant_id,case_id,actor_user_id,action,entity_type,entity_id,payload)
      VALUES(NEW.tenant_id,NEW.case_id,auth.uid(),'CONTRADICTION_RESOLVED','contradiction',NEW.id,
      jsonb_build_object('prior_status',OLD.status,'explanation',NEW.resolution_note,
        'supporting_document_id',NEW.resolution_document_id,'evidence_reference',NEW.resolution_evidence_reference));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS evidenced_resolution ON public.contradictions;
CREATE TRIGGER evidenced_resolution BEFORE UPDATE ON public.contradictions
  FOR EACH ROW EXECUTE FUNCTION public.guard_evidenced_resolution();
-- Status update and audit insert share a transaction. An audit/RLS failure aborts both.
