CREATE TYPE public.app_role AS ENUM ('admin','investigator','viewer');

CREATE TABLE public.tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE, role public.app_role NOT NULL DEFAULT 'investigator', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (user_id, tenant_id));
CREATE TABLE public.cases (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE, reference_no text NOT NULL, title text, dispute_type text NOT NULL DEFAULT 'DEMURRAGE', vessel_name text, voyage_no text, container_no text, port_code text, counterparty text, status text NOT NULL DEFAULT 'OPEN', created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE, case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE, name text NOT NULL, file_path text NOT NULL, file_type text NOT NULL, sha256_hash text NOT NULL, source_party text, evidence_class text NOT NULL DEFAULT 'CUSTOMER_PRIMARY', extraction_status text NOT NULL DEFAULT 'PENDING', uploaded_by uuid, uploaded_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.extracted_claims (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE, case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE, document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE, page_number int, claim_text text NOT NULL, claim_type text, normalized_value jsonb, evidence_class text NOT NULL DEFAULT 'CUSTOMER_PRIMARY', nature text NOT NULL DEFAULT 'REPORTED', status text NOT NULL DEFAULT 'PENDING', confidence numeric, timestamp_claimed timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.contradictions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE, case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE, title text NOT NULL, description text, claim_a_id uuid REFERENCES public.extracted_claims(id) ON DELETE SET NULL, claim_b_id uuid REFERENCES public.extracted_claims(id) ON DELETE SET NULL, severity text NOT NULL DEFAULT 'MEDIUM', detected_by text NOT NULL DEFAULT 'RULE', citations jsonb, status text NOT NULL DEFAULT 'FLAGGED', resolved_by uuid, resolved_at timestamptz, resolution_note text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.timeline_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE, case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE, "timestamp" timestamptz NOT NULL, title text NOT NULL, source text, evidence_class text NOT NULL DEFAULT 'CUSTOMER_PRIMARY', nature text NOT NULL DEFAULT 'REPORTED', coordinates jsonb, provenance_id uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.external_observations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE, case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE, source text NOT NULL, observation_type text NOT NULL, observed_at timestamptz NOT NULL, latitude double precision, longitude double precision, payload jsonb, confidence numeric, limitation text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.commercial_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE, name text NOT NULL, rule_version text NOT NULL, rule_type text NOT NULL, currency text, payload jsonb, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id, name, rule_version));
CREATE TABLE public.financial_calculations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE, case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE, calculation_type text NOT NULL, rule_version text, input_payload jsonb, result_payload jsonb, calculated_amount_minor bigint, charged_amount_minor bigint, variance_minor bigint, currency text, created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.evidence_packs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE, case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE, version int NOT NULL, pack_payload jsonb NOT NULL, sha256_hash text NOT NULL, status text NOT NULL DEFAULT 'DRAFT', approved_by uuid, approved_at timestamptz, generated_at timestamptz NOT NULL DEFAULT now(), UNIQUE (case_id, version));
CREATE TABLE public.audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE, case_id uuid REFERENCES public.cases(id) ON DELETE CASCADE, actor_user_id uuid, action text NOT NULL, entity_type text, entity_id uuid, payload jsonb, created_at timestamptz NOT NULL DEFAULT now());

CREATE INDEX ON public.user_roles(user_id);
CREATE INDEX ON public.cases(tenant_id);
CREATE INDEX ON public.documents(case_id);
CREATE INDEX ON public.extracted_claims(case_id);
CREATE INDEX ON public.contradictions(case_id);
CREATE INDEX ON public.timeline_events(case_id);
CREATE INDEX ON public.external_observations(case_id);
CREATE INDEX ON public.financial_calculations(case_id);
CREATE INDEX ON public.evidence_packs(case_id);
CREATE INDEX ON public.audit_log(case_id);

CREATE OR REPLACE FUNCTION public.is_tenant_member(_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND tenant_id = _tenant_id)
$$;

GRANT SELECT ON public.tenants TO authenticated;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.tenants, public.user_roles TO service_role;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read tenant" ON public.tenants FOR SELECT TO authenticated USING (public.is_tenant_member(id));
CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cases','documents','extracted_claims','contradictions','timeline_events','external_observations','commercial_rules','financial_calculations'] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "Tenant select" ON public.%I FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id))', t);
    EXECUTE format('CREATE POLICY "Tenant insert" ON public.%I FOR INSERT TO authenticated WITH CHECK (public.is_tenant_member(tenant_id))', t);
    EXECUTE format('CREATE POLICY "Tenant update" ON public.%I FOR UPDATE TO authenticated USING (public.is_tenant_member(tenant_id)) WITH CHECK (public.is_tenant_member(tenant_id))', t);
    EXECUTE format('CREATE POLICY "Tenant delete" ON public.%I FOR DELETE TO authenticated USING (public.is_tenant_member(tenant_id))', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON public.evidence_packs TO authenticated;
GRANT ALL ON public.evidence_packs TO service_role;
ALTER TABLE public.evidence_packs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant select" ON public.evidence_packs FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant insert" ON public.evidence_packs FOR INSERT TO authenticated WITH CHECK (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant update" ON public.evidence_packs FOR UPDATE TO authenticated USING (public.is_tenant_member(tenant_id)) WITH CHECK (public.is_tenant_member(tenant_id));

GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant select" ON public.audit_log FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant insert" ON public.audit_log FOR INSERT TO authenticated WITH CHECK (public.is_tenant_member(tenant_id));

CREATE OR REPLACE FUNCTION public.guard_evidence_pack()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.pack_payload IS DISTINCT FROM OLD.pack_payload OR NEW.sha256_hash IS DISTINCT FROM OLD.sha256_hash
     OR NEW.version IS DISTINCT FROM OLD.version OR NEW.case_id IS DISTINCT FROM OLD.case_id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'EVIDENCE_PACK_IMMUTABLE';
  END IF;
  IF OLD.status <> 'DRAFT' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'EVIDENCE_PACK_FINALISED';
  END IF;
  IF NEW.status = 'APPROVED' AND OLD.status = 'DRAFT' THEN NEW.approved_at := now(); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER evidence_pack_immutable BEFORE UPDATE ON public.evidence_packs FOR EACH ROW EXECUTE FUNCTION public.guard_evidence_pack();

CREATE OR REPLACE FUNCTION public.seed_demo_case(_tenant uuid, _user uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c uuid; d_bol uuid; d_car uuid; d_term uuid; d_inv uuid;
  cl uuid[] := ARRAY[]::uuid[]; x uuid;
BEGIN
  INSERT INTO cases (tenant_id, reference_no, title, dispute_type, vessel_name, voyage_no, container_no, port_code, counterparty, status, created_by)
  VALUES (_tenant, 'DUR-2026-0412', 'Disputed demurrage — Durban Container Terminal Pier 2', 'DEMURRAGE', 'MV Umhlanga Trader', '214S', 'MSKU7748213', 'ZADUR', 'Coastline Ocean Lines', 'UNDER_REVIEW', _user)
  RETURNING id INTO c;

  INSERT INTO documents (tenant_id, case_id, name, file_path, file_type, sha256_hash, source_party, evidence_class, extraction_status) VALUES
    (_tenant, c, 'Bill_of_Lading_MSKU7748213.pdf', 'demo/bol.pdf', 'application/pdf', encode(sha256('demo-bol'::bytea),'hex'), 'Shipper', 'CUSTOMER_PRIMARY', 'DONE') RETURNING id INTO d_bol;
  INSERT INTO documents (tenant_id, case_id, name, file_path, file_type, sha256_hash, source_party, evidence_class, extraction_status) VALUES
    (_tenant, c, 'Carrier_Availability_Notice.pdf', 'demo/notice.pdf', 'application/pdf', encode(sha256('demo-notice'::bytea),'hex'), 'Carrier', 'CUSTOMER_PRIMARY', 'DONE') RETURNING id INTO d_car;
  INSERT INTO documents (tenant_id, case_id, name, file_path, file_type, sha256_hash, source_party, evidence_class, extraction_status) VALUES
    (_tenant, c, 'Terminal_Release_Record_DCT.csv', 'demo/terminal.csv', 'text/csv', encode(sha256('demo-terminal'::bytea),'hex'), 'Transnet Port Terminals', 'OFFICIAL_PUBLIC', 'DONE') RETURNING id INTO d_term;
  INSERT INTO documents (tenant_id, case_id, name, file_path, file_type, sha256_hash, source_party, evidence_class, extraction_status) VALUES
    (_tenant, c, 'Demurrage_Invoice_INV-88213.pdf', 'demo/invoice.pdf', 'application/pdf', encode(sha256('demo-invoice'::bytea),'hex'), 'Carrier', 'CONTRACTUAL', 'DONE') RETURNING id INTO d_inv;

  INSERT INTO extracted_claims (tenant_id, case_id, document_id, page_number, claim_text, claim_type, evidence_class, nature, status, confidence, timestamp_claimed) VALUES (_tenant,c,d_bol,1,'Container MSKU7748213 shipped on MV Umhlanga Trader voyage 214S, port of discharge Durban.','SHIPMENT','CUSTOMER_PRIMARY','OBSERVED','VERIFIED',0.97,NULL) RETURNING id INTO x; cl := cl || x;
  INSERT INTO extracted_claims (tenant_id, case_id, document_id, page_number, claim_text, claim_type, evidence_class, nature, status, confidence, timestamp_claimed) VALUES (_tenant,c,d_car,1,'Vessel discharged container at DCT Pier 2.','DISCHARGE','CUSTOMER_PRIMARY','REPORTED','VERIFIED',0.9,'2026-09-02T06:40:00Z') RETURNING id INTO x; cl := cl || x;
  INSERT INTO extracted_claims (tenant_id, case_id, document_id, page_number, claim_text, claim_type, evidence_class, nature, status, confidence, timestamp_claimed) VALUES (_tenant,c,d_car,1,'Carrier states container available for collection from 02 Sep 2026 08:00.','AVAILABILITY','CUSTOMER_PRIMARY','REPORTED','PENDING',0.88,'2026-09-02T08:00:00Z') RETURNING id INTO x; cl := cl || x;
  INSERT INTO extracted_claims (tenant_id, case_id, document_id, page_number, claim_text, claim_type, evidence_class, nature, status, confidence, timestamp_claimed) VALUES (_tenant,c,d_term,1,'Terminal customs/terminal release recorded 06 Sep 2026 14:20 (hold lifted).','AVAILABILITY','OFFICIAL_PUBLIC','OBSERVED','PENDING',0.93,'2026-09-06T14:20:00Z') RETURNING id INTO x; cl := cl || x;
  INSERT INTO extracted_claims (tenant_id, case_id, document_id, page_number, claim_text, claim_type, evidence_class, nature, status, confidence, timestamp_claimed) VALUES (_tenant,c,d_term,1,'Gate-out of MSKU7748213 recorded 13 Sep 2026 10:05.','GATE_OUT','OFFICIAL_PUBLIC','OBSERVED','VERIFIED',0.95,'2026-09-13T10:05:00Z') RETURNING id INTO x; cl := cl || x;
  INSERT INTO extracted_claims (tenant_id, case_id, document_id, page_number, claim_text, claim_type, evidence_class, nature, status, confidence, timestamp_claimed) VALUES (_tenant,c,d_inv,1,'Invoice charges 11 demurrage days at ZAR 4,800/day = ZAR 52,800.','CHARGE','CONTRACTUAL','REPORTED','DISPUTED',0.96,NULL) RETURNING id INTO x; cl := cl || x;
  INSERT INTO extracted_claims (tenant_id, case_id, document_id, page_number, claim_text, claim_type, evidence_class, nature, status, confidence, timestamp_claimed) VALUES (_tenant,c,d_inv,2,'Free time stated as 3 calendar days from availability.','FREE_TIME','CONTRACTUAL','OBSERVED','VERIFIED',0.92,NULL) RETURNING id INTO x; cl := cl || x;
  INSERT INTO extracted_claims (tenant_id, case_id, document_id, page_number, claim_text, claim_type, evidence_class, nature, status, confidence, timestamp_claimed) VALUES (_tenant,c,d_inv,2,'Invoice states demurrage clock started 02 Sep 2026.','CLOCK_START','CONTRACTUAL','REPORTED','PENDING',0.85,'2026-09-02T00:00:00Z') RETURNING id INTO x; cl := cl || x;
  INSERT INTO extracted_claims (tenant_id, case_id, document_id, page_number, claim_text, claim_type, evidence_class, nature, status, confidence, timestamp_claimed) VALUES (_tenant,c,d_term,1,'Container under port health hold 02–06 Sep 2026.','HOLD','OFFICIAL_PUBLIC','OBSERVED','PENDING',0.87,'2026-09-03T09:00:00Z') RETURNING id INTO x; cl := cl || x;
  INSERT INTO extracted_claims (tenant_id, case_id, document_id, page_number, claim_text, claim_type, evidence_class, nature, status, confidence, timestamp_claimed) VALUES (_tenant,c,NULL,NULL,'Chargeable days recomputed from terminal release: 7 days (ZAR 33,600).','CALCULATION','DERIVED','DERIVED','PENDING',0.9,NULL) RETURNING id INTO x; cl := cl || x;

  INSERT INTO contradictions (tenant_id, case_id, title, description, claim_a_id, claim_b_id, severity, detected_by, citations, status) VALUES
    (_tenant,c,'Availability vs terminal release','Carrier notice (p.1) says available 02 Sep 08:00; terminal record (p.1) shows release only 06 Sep 14:20 — 4 days 6 hours apart.',cl[3],cl[4],'HIGH','RULE','[{"doc":"Carrier_Availability_Notice.pdf","page":1},{"doc":"Terminal_Release_Record_DCT.csv","page":1}]','FLAGGED'),
    (_tenant,c,'Clock start during port health hold','Invoice (p.2) starts the clock 02 Sep while the terminal record shows a port health hold until 06 Sep.',cl[8],cl[9],'HIGH','AI','[{"doc":"Demurrage_Invoice_INV-88213.pdf","page":2},{"doc":"Terminal_Release_Record_DCT.csv","page":1}]','FLAGGED'),
    (_tenant,c,'Discharge time vs AIS berth departure','Discharge reported 06:40; AIS shows vessel at berth until 11:10 — consistent, reviewed.',cl[2],NULL,'LOW','RULE','[{"doc":"Carrier_Availability_Notice.pdf","page":1}]','RESOLVED');

  INSERT INTO timeline_events (tenant_id, case_id, "timestamp", title, source, evidence_class, nature, coordinates, provenance_id) VALUES
    (_tenant,c,'2026-09-01T22:15:00Z','Vessel enters Durban anchorage','AIS (AISStream)','INDEPENDENT_OBSERVATION','OBSERVED','{"lat":-29.92,"lon":31.11}',NULL),
    (_tenant,c,'2026-09-02T03:30:00Z','Vessel berths at DCT Pier 2','AIS (AISStream)','INDEPENDENT_OBSERVATION','OBSERVED','{"lat":-29.873,"lon":31.025}',NULL),
    (_tenant,c,'2026-09-02T06:40:00Z','Container discharged','Carrier_Availability_Notice.pdf p.1','CUSTOMER_PRIMARY','REPORTED',NULL,cl[2]),
    (_tenant,c,'2026-09-02T08:00:00Z','Carrier claims container available','Carrier_Availability_Notice.pdf p.1','CUSTOMER_PRIMARY','DISPUTED',NULL,cl[3]),
    (_tenant,c,'2026-09-03T09:00:00Z','Port health hold in force','Terminal_Release_Record_DCT.csv','OFFICIAL_PUBLIC','OBSERVED',NULL,cl[9]),
    (_tenant,c,'2026-09-04T07:52:00Z','Sentinel-2 scene over Pier 2 stack','Copernicus Sentinel-2','INDEPENDENT_OBSERVATION','OBSERVED','{"lat":-29.872,"lon":31.03}',NULL),
    (_tenant,c,'2026-09-06T14:20:00Z','Terminal release recorded','Terminal_Release_Record_DCT.csv','OFFICIAL_PUBLIC','OBSERVED',NULL,cl[4]),
    (_tenant,c,'2026-09-13T10:05:00Z','Container gate-out','Terminal_Release_Record_DCT.csv','OFFICIAL_PUBLIC','OBSERVED','{"lat":-29.868,"lon":31.02}',cl[5]),
    (_tenant,c,'2026-09-13T12:00:00Z','Free time + chargeable days derived','CargoIQ rules engine v2026.09','DERIVED','DERIVED',NULL,cl[10]);

  INSERT INTO external_observations (tenant_id, case_id, source, observation_type, observed_at, latitude, longitude, payload, confidence, limitation) VALUES
    (_tenant,c,'AISStream','AIS_POSITION','2026-09-01T22:15:00Z',-29.92,31.11,'{"vesselName":"MV Umhlanga Trader","sog":0.2}',0.8,'AIS corroborates position only.'),
    (_tenant,c,'AISStream','AIS_POSITION','2026-09-02T01:10:00Z',-29.90,31.07,'{"vesselName":"MV Umhlanga Trader","sog":6.1}',0.8,'AIS corroborates position only.'),
    (_tenant,c,'AISStream','AIS_POSITION','2026-09-02T03:30:00Z',-29.873,31.025,'{"vesselName":"MV Umhlanga Trader","sog":0}',0.8,'AIS corroborates position only.'),
    (_tenant,c,'AISStream','AIS_POSITION','2026-09-02T11:10:00Z',-29.88,31.04,'{"vesselName":"MV Umhlanga Trader","sog":4.0}',0.8,'AIS corroborates position only.'),
    (_tenant,c,'Copernicus Sentinel Data Space','SENTINEL_2_SCENE','2026-09-04T07:52:00Z',-29.872,31.03,'{"cloudCover":8}',0.7,'Scene coverage only; needs human inspection.'),
    (_tenant,c,'Copernicus Sentinel Data Space','SENTINEL_1_SCENE','2026-09-06T03:41:00Z',-29.872,31.03,'{"mode":"IW"}',0.7,'Scene coverage only; needs human inspection.'),
    (_tenant,c,'Open-Meteo Marine','MARINE_WEATHER','2026-09-03T12:00:00Z',-29.8833,31.05,'{"wave_height":1.4,"wind_speed":18}',0.6,'Weather is contextual only.');

  INSERT INTO financial_calculations (tenant_id, case_id, calculation_type, rule_version, input_payload, result_payload, calculated_amount_minor, charged_amount_minor, variance_minor, currency, created_by) VALUES
    (_tenant,c,'DEMURRAGE','2026.09','{"start":"2026-09-06T14:20:00Z","release":"2026-09-13T10:05:00Z","freeDays":3,"dailyRate":4800}','{"chargeableDays":7,"total":33600}',3360000,5280000,1920000,'ZAR',_user);

  INSERT INTO audit_log (tenant_id, case_id, actor_user_id, action, entity_type, entity_id, payload) VALUES (_tenant,c,_user,'DEMO_CASE_SEEDED','case',c,'{}');
  RETURN c;
END $$;
REVOKE EXECUTE ON FUNCTION public.seed_demo_case(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.provision_organization(org_name text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); t uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  SELECT tenant_id INTO t FROM user_roles WHERE user_id = uid ORDER BY created_at LIMIT 1;
  IF t IS NOT NULL THEN RETURN t; END IF;
  INSERT INTO tenants (name) VALUES (COALESCE(NULLIF(trim(org_name),''), 'My investigations workspace')) RETURNING id INTO t;
  INSERT INTO user_roles (user_id, tenant_id, role) VALUES (uid, t, 'admin');
  PERFORM seed_demo_case(t, uid);
  RETURN t;
END $$;
REVOKE EXECUTE ON FUNCTION public.provision_organization(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_organization(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_member(uuid) TO authenticated;