# Brenda workflow build: 16 October 2026

## State

Source build, not a declaration of live deployment or production readiness. This document describes the build and local checks. Applying SQL, publishing and authenticated live acceptance are separate steps. No internal terminal/TBS feed or undocumented API is connected. No real member invitations, shared workspace launch, provider/billing changes or AI feature activation.

## Added

- Counts: immutable source ledger, source organization/document checks, physical identity, hatch operations/lifts, truck visits, containers/TEU, physical/virtual gate in/out. Explicit accepted effective-dated formulas retain raw quantities.
- Common-unit comparisons: explicit mappings for each source basis, exact output unit and agreed physical scope. Missing scopes, incompatible/ambiguous/superseded mappings, duplicates and unagreed rules withhold results. Organizations are not summed. A difference is not automatically a factual contradiction.
- Quantity productivity: chosen current KPI clock definition, exactly matching scope, positive reconciled duration and count timestamps within that interval. No invented operating hours or universal benchmark.
- Appointment lifecycle: immutable slot revisions, attendance, cancellation, system failures and human responsibility reviews. Issuer is distinct from claim target. Conflicting/missing data or slot changes after attendance withhold compliance. Lateness does not assign fault.
- Authorised exports: exact-schema CSV preview for count and appointment sources, operator's authority basis, source-backed row mapping, 500-row / 300,000-character limits, no AI. Transactional import preserves original CSV/hash/actor and links derived rows. SQL re-parses CSV and rejects altered mappings. Repeat imports reject rather than duplicate.
- Evidence pack: five new registers in the existing atomic source snapshot. New evidence invalidates stale snapshot writes under the same case lock. Frozen JSON retains raw sources and provenance; deterministic PDF reproduces v1 calculations from frozen data only. Old packs remain immutable.

## Local checks

- TypeScript and production build pass.
- 100 unit tests pass; one pre-existing test remains skipped.
- Disposable database: full existing schema plus all new migrations, investigator append, viewer/foreign-tenant isolation, immutable history, stale revisions, forced audit rollback, import idempotency/raw-to-mapping tamper rejection, common-unit scope/version guards and extended atomic pack freshness pass.
- Original atomic-pack and viewer/storage guard checks still pass.
- Actual components rendered at 1280px and 390px with explicitly labelled synthetic fixtures, no mobile document overflow. Count output 4 lifts -> 1 operation and 1 operation -> 1 operation; 2 evidenced hours -> 0.5 operation/hour. TBS timing and distinct issuer/claim-target review displayed. These fixture screenshots are not live-backend acceptance.

## Deployment

Apply `docs/verification/brenda-registers-manual-apply.sql` once, in the correct CargoIQ Cloud SQL editor, before publishing the dependent app. It is one transaction and refuses repeats/partial installations. Final result: `brenda_operational_registers_applied`, four true register columns. If any error occurs, inspect and do not blindly rerun.

The six individual SQL files are ordered migration history, not an additional second manual apply. Do not rerun older bundles. A previously generated draft may need to be regenerated because the source schema now includes new evidence registers; historical payloads and bytes are never rewritten.

## Live acceptance still required

Create only clearly marked synthetic fixtures. Import a real-format synthetic export through the UI, reload and verify source rows/provenance; exercise revision, rule mapping, common scope and productivity; check draft/frozen JSON/PDF and stale-source rejection. Test independent concurrent writes and original DUR flags. Phone-test the published site after Publish. Do not call source push, local fixtures or disposable database checks a live migration, live test or production/load acceptance.
