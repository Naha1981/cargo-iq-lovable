# Historical record review contribution: unreleased candidate

Based on 7dc217163dbb3e8cdc501ec7d7be7fafa44d09da. No further push or hosted database apply is authorized by that prior release.

The existing Harbour historical command repair only saved a browser-local tray reference. This candidate adds an explicit parent-case confirmation, an authenticated server call, and a proposed transaction that derives matching case timeline records from the database. It records reviewed date, timezone, candidate place/filter, source bytes/IDs, actor/time and uncertainty in immutable external observations with atomic audit. The existing canonical core source already freezes external observations; no live reads are appended to old packs. PDF has a distinct human-readable historical-review section, never labeled an independent observation. The human-readable summary and JSON retain the same frozen payload.

No voice transcript or browser-supplied source records are accepted as facts. Same-origin plus exact iframe-source validation is necessary but not sufficient: the server fixes case/tenant and SQL derives the source records. Direct observation inserts of this type are also normalized by a database trigger and audited atomically. No terminal/vessel identity, shipment location, selected-day basemap imagery, exposure, causation or liability is inferred. Empty result sets retain uncertainty.

## Activation is blocked pending target qualification

- `historical_record_review.sql` is proposal-only, not a migration or auto-applied script.
- Separate readiness fingerprint covers the review RPC/derivation/audit functions and core tables' trigger/RLS/ACL definitions. It fails closed if absent or changed. The pinned fingerprint is an isolated local catalog, NOT a production fingerprint.
- Both integrated and historical readiness must be checked in the combined release. The existing integrated selector does not cover external-observation definitions or these new historical functions; adding them need not change its pin. That fact is not proof of combined behavior or access. Do not change a hash to force activation.
- Review target version/owner/grants, existing source function bodies, enabled case-lock/immutability/audit guards, backup and rollback route before preparing a target-bound package. No production SQL or synthetic acceptance writes approved.
- Review RPC uses one operation ID for retries, persisted via the existing opaque-operation helper under a feature/case-specific namespace. Only a filter digest and UUID are stored. Reload after an uncertain response reuses the same ID for the same reviewed filter; confirmed success clears it. A different filter is a distinct contribution.
- Actual deployed speech recognition, device microphone, imagery availability, case save, canonical generation, JSON/PDF export and isolation acceptance remain unverified.
- Long PDFs refuse beyond existing size/page budgets rather than silently truncate review records. No historical pixels are attached.

## Local evidence

Isolated PostgreSQL proof covers investigator/viewer/foreign/anonymous boundaries, SAST dates, malformed/out-of-radius exclusion, server-derived case-only source, direct-write injection normalization, idempotent retry/conflict, zero-result uncertainty, immutable records and atomic audit failure rollback. Readiness refuses after audit trigger disable. Route tests cover source/origin rejection, preview-before-confirm, cancel-no-write and same-ID retry. Desktop and 390px component pixels and synthetic PDF pages 1-2 inspected. These are fixture proofs, not production acceptance.

The local proof additionally persists a real DRAFT canonical pack using the existing RPC, verifies canonical bytes and SHA-256, saves a later review, verifies old frozen bytes remain unchanged and refuses generation from stale source. These are isolated synthetic DB results, not deployed proof. Local full build reached the host's approximately 2 GB heap limit; no green full-build result for this new batch is claimed.

Combined install order: core migrations, feature atomic audit, recovery batch, feature readiness, integrated source, then historical review proposal. Isolated combined target-defaultACL mode now exercises the complete save, both readiness checks, source, canonical persistence/hash/audit and stale-source refusal as authenticated investigator, with viewer/foreign/anonymous refusals. It models the previously observed staging defaults only; it applies no hosted grants. Ordinary-ACL mode reports missing risk SELECT permissions and refuses authenticated canonical generation, even when both readiness checks are true. Thus readiness alone is not target activation acceptance. Outer target baseline must additionally bind columns/constraints/auth.uid()/defaultACL/readiness body/owners/grants before any apply. Actual two-session lock interleaving and same-ID concurrency are still not established for the new historical path.
