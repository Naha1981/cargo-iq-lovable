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

Apply the SQL migrations under supabase/migrations/.

Required client variables:

- VITE_SUPABASE_URL
- VITE_SUPABASE_PUBLISHABLE_KEY

Optional server variables:

- GEMINI_API_KEY
- GEMINI_MODEL
- AISSTREAM_API_KEY
- AIS_PUBLIC_HTTP_URL
- SUPABASE_SERVICE_ROLE_KEY (server only)
- CARGOI_Q_CCTV_ENCRYPTION_KEY (server only)

The SQL migration creates tenant-scoped tables, Auth onboarding, RLS, private case-document storage and the audit trail.

## Document pipeline

Documents are stored under:
case-documents/{tenant_id}/{case_id}/{filename}

The server downloads the private object, computes SHA-256 and stores immutable metadata. Extraction can use Gemini for structured PDF evidence or a deterministic CSV/TXT fallback. Claims and timestamped timeline events are persisted for human review.

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
