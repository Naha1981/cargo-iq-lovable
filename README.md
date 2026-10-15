# CargoIQ — Investigative Evidence & Dispute Intelligence

CargoIQ is the NahaLabs evidence-first platform for freight, demurrage and port logistics disputes.

## Forward-development repository

Primary repository from 3 October 2026:
https://github.com/Naha1981/cargo-iq-lovable

Previous migration reference:
https://github.com/Naha1981/cargoiq-qwen

Original tactical/recon reference:
https://github.com/bilawalsidhu/gods-eye-view

CargoIQ does not copy the original project wholesale. Its visual ideas are used as a case-scoped evidence investigation surface.

## Stack

- TanStack Start
- React 19
- Vite + Lovable TanStack config
- Tailwind CSS v4
- Lovable Cloud / Supabase PostgreSQL
- Supabase native Auth
- PostgreSQL Row-Level Security
- Private Supabase Storage
- TanStack server functions
- AISStream-compatible vessel feeds
- Copernicus Sentinel STAC
- Open-Meteo Marine

## Core workflow

Documents / records
→ extracted claims
→ timeline
→ contradictions
→ independent corroboration
→ deterministic money
→ human review
→ immutable evidence pack

## Evidence truth rules

CargoIQ distinguishes:

- OBSERVED
- REPORTED
- DERIVED
- INFERRED
- DISPUTED

External data is corroboration unless the source itself establishes the disputed event. Inferences never become verified automatically.

## CCTV computer-vision evidence

CargoIQ can accept event-specific CCTV observations from a customer-site Lot Vulture edge deployment.

CCTV / IP camera → Lot Vulture → CargoIQ edge adapter → signed HTTPS → CCTV observation → case timeline → evidence pack

RTSP camera credentials and continuous camera streams stay at the customer site. CargoIQ stores normalized event metadata and source artefacts for material events.

The CCTV evidence model preserves source/camera/zone provenance, timestamps, model/version metadata, provider confidence when available, SHA-256 over the actual media bytes, human review status and explicit limitations.

CCTV remains INDEPENDENT_OBSERVATION. It does not automatically identify a vehicle, establish shipment identity or decide legal liability.

See:
- docs/CCTV-EVIDENCE-ARCHITECTURE.md
- docs/SOURCE-LICENSE-REGISTER.md
- edge/lotvulture-cargoiq/README.md

## Lovable Cloud setup

Database deployment order (review the target database first; do not replay CREATE TABLE migrations against an existing initialized database):

1. Core schema/auth/RLS/storage: `drizzle/migrations/0000_cargoiq_core.sql`.
2. Storage upload policies: `drizzle/migrations/0001_case_documents_policies.sql`.
3. CCTV extension: `supabase/migrations/20261005190000_cctv_evidence.sql`.
4. Evidenced resolutions: `supabase/migrations/20261015141000_evidenced_resolution.sql`.

These are currently split migration histories. `supabase db push` alone does not discover the core Drizzle files. For a new environment, use the reviewed SQL files in the order above through the database SQL runner and record each applied migration. For an existing environment, inspect migration history and schema and apply only missing changes. Do not duplicate the core schema into Supabase history without an explicit baselining plan. The Drizzle schema.ts is intentionally blank; the SQL migration is the current core schema source.

Deploy migration 4 before the new resolution UI/server code. If its trigger or audit insert fails, resolution must remain blocked. Test this against staging before publishing; a source merge is not evidence of a successful database deployment.

Required client variables:

- VITE_SUPABASE_URL
- VITE_SUPABASE_PUBLISHABLE_KEY

Optional server variables:

- CLAIM_AI_PROVIDER (`gateway`, `openai`, or `anthropic`; set explicitly to avoid implicit key priority)
- LOVABLE_API_KEY (server-only, for `gateway`; uses existing Lovable gateway access/credits)
- OPENAI_API_KEY (server-only, for `openai`)
- ANTHROPIC_API_KEY (server-only, for `anthropic`)
- CLAIM_AI_MODEL (OpenAI/Anthropic override only; gateway currently uses `openai/gpt-6-astra` in code)
- AISSTREAM_API_KEY
- AIS_PUBLIC_HTTP_URL
- SUPABASE_SERVICE_ROLE_KEY (server only)
- CARGOI_Q_CCTV_ENCRYPTION_KEY (server only)

The SQL migration creates tenant-scoped tables, Auth onboarding, RLS, private case-document storage and the audit trail.

## Document pipeline

Documents are stored under:
case-documents/{tenant_id}/{case_id}/{filename}

The server downloads the private object, computes SHA-256 and stores immutable metadata. Extraction selects OpenAI, Anthropic or the Lovable gateway. With no explicit provider it prefers an available OpenAI key, then Anthropic, then Lovable; set `CLAIM_AI_PROVIDER=gateway` to retain Lovable when other keys exist. GEMINI_API_KEY/GEMINI_MODEL are not read by the current extractor. AI requests can consume provider funds or Lovable credits; configuration is not spending approval. PDF AI extraction requires the chosen provider key. CSV/TXT fallback creates text records and does not prove timestamp-conflict detection. Claims and timestamped timeline events are persisted for human review.

## God’s Eye View

/cases/$caseId/map is a tactical case-scoped HUD with:

- authenticated/live-sensor status ribbons;
- UTC master clock;
- target lock and coordinates;
- sensor azimuth / field-of-view;
- CRT scanlines and vignette;
- targeting reticle;
- AIS route and SOG trail;
- Sentinel-1 and Sentinel-2 footprints;
- temporal playback;
- AIS/SAR/MSI/weather/infrastructure toggles;
- timeline alignment;
- contradiction callouts.

It is an evidence surface, not an autonomous truth machine.

## Launch gate

CargoIQ is pilot-ready when:

1. Lovable Cloud migration is applied;
2. native Auth sign-up/sign-in works;
3. RLS isolation is tested with two tenants;
4. a document uploads and hashes;
5. extraction creates reviewable claims;
6. a contradiction is persisted and resolved;
7. AIS/Sentinel/weather corroboration attaches to a case;
8. deterministic demurrage is reproducible;
9. evidence pack hashing is reproducible;
10. an investigator approves a frozen pack.

The 50-client production gate additionally requires provider/licence review, backups, observability, billing and repeatable onboarding.

## Review provenance and corroboration limits

Uploads require the source organization, stored as documents.source_party. A multi-file selection uses one organization; upload different organizations separately. Legacy uploads may have no recorded source.

New contradiction resolutions require an explanation (10-4000 characters), a document belonging to the same case and tenant, and a page/row/event/section reference (3-1000 characters). The database trigger sets the authenticated resolver/time and appends CONTRADICTION_RESOLVED with that evidence in the same transaction. This records the human decision; it does not verify the explanation is true. Legacy resolutions remain visible as legacy, not retroactively evidenced.

Corroboration currently supports verified approximate centers for ZADUR/Durban, ZACPT/Cape Town and ZARCB/Richards Bay. Unknown/missing ports fail before external queries. Add a verified center before supporting another port. Query centers are not berth locations. The separate schematic map still contains Durban-specific projection/labels; this patch does not make that map port-neutral or 3D.
