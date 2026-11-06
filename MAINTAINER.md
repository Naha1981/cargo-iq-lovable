# Maintainer notes

Technical reference only, not customer-facing wording. Reviewed 6 November 2026. These commands are defined in the source, not newly executed in this documentation pass. Use the repository lockfile and established CI/runtime versions. No release or production migration is authorised by this file.

## Defined commands

```sh
npm run dev
npm run build
npm run test
npm run lint
```

## Preserved database, extraction and evidence notes

The following technical sections are retained from the previous README. Their operational claims are not a new live certification. Do not replay migrations blindly.

## Lovable Cloud setup

Database deployment order (review the target database first; do not replay CREATE TABLE migrations against an existing initialized database):

1. Core schema/auth/RLS/storage: `drizzle/migrations/0000_cargoiq_core.sql`.
2. Storage upload policies: `drizzle/migrations/0001_case_documents_policies.sql`.
3. CCTV extension: `supabase/migrations/20261005190000_cctv_evidence.sql`.
4. Evidenced resolutions: `supabase/migrations/20261015141000_evidenced_resolution.sql`.

These are split migration histories. `supabase db push` alone does not discover the core Drizzle files. For a NEW environment the supported path is the versioned runner:

    PGHOST=... PGPORT=5432 PGDATABASE=postgres PGUSER=postgres.<ref> PGPASSWORD=... PGSSLMODE=require \
    node scripts/db-migrate.mjs from-zero

It applies both layers once, in the proven order (38 files at time of writing), records each file's SHA-256 in a locked `public.schema_migrations` ledger, refuses to run from-zero against a populated database, and fails on checksum drift. `status`, `apply` (pending only) and `adopt` (hand-built databases only) cover the other states. Backup scope and the measured restore procedure live in docs/DB-OPERATIONS.md. For an existing environment, inspect migration history and schema and apply only missing changes. Do not duplicate the core schema into Supabase history without an explicit baselining plan. The Drizzle schema.ts is intentionally blank; the SQL migration is the current core schema source.

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

## Configuration and costs

Use current example environment schemas and source reads to determine required configuration. Examples contain placeholders only. Do not print credentials or replace licence/attribution files. Do not activate messages, payments, migrations or publication without the applicable approval. No unlimited free service or permanent quota is promised.
