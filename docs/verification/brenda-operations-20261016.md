# Operational release verification - 16 October 2026

## Scope and verdict

Operational workflow acceptance is GREEN for a supervised Brenda demo using approved synthetic data. Not a shared-workspace/member rollout or a claim of production/load readiness. The source release must still be distinguished from the separately published website version.

Integrates PRs9/10/11/12/14/15/17 onto current main. Dedicated Definitions and Clocks tabs, appointment attribution, per-party KPIs, human event matches and identity review history, evidenced resolutions, reconciliations, evidence gaps, frozen JSON/PDF exports. Shared workspace remains excluded. WhatsApp remains separate draft PR21 and OFF.

## Build and pixels

- Vite/Nitro build and strict TypeScript pass;18test files,66passed,1existing skip.
- Actual authenticated staged app with production backend: all operational tabs, desktop and390px mobile, no horizontal mobile overflow.
- Atomic app pack generation, JSON/PDF downloads and approval pass. All8operational/history registers present. Every exported PDF page inspected; approval/signature lines and limitations kept together.
- Viewer app-server generation denied before persistence. Every core POST has an early investigator/admin check, including extraction and corroboration.

## Live authenticated acceptance

- Actual private source upload/SHA; definition versions preserve units and original text; stale writes reject. Two independent concurrent requests produce exactly1winning definition revision.
- Wrong-case source rejection; original offset/timezone coherence;12h outside queue vs2h inside terminal, no convenient clock selection.
- Unreconciled clocks block financial/pack writes. Evidenced decisions freeze source IDs; later source invalidates old decisions. Appointment issuer and claim target remain attributed assertions, not liability.
- Controlled same-event cross-document timestamp conflict creates a real FLAGGED contradiction. Duplicate/reversed pairs reject; identity retraction alone does not clear flags. Blank resolution rejects; evidenced resolution records actor/time/source audit.
- Required evidence received/conflicting states enforce supporting source counts; missing is not non-occurrence. KPI missing clocks/benchmark retained without universal18h.
- Financial writes only after gates clear; money and frozen payload append-only/immutable.
- Second auth account provisions isolated tenant after seed fix: its own seed has2flags,0money. Bidirectional tenant isolation verified for case/document/register/pack/financial reads. Foreign source writes reject. Own-tenant money/pack rows referencing foreign case reject.
- Actual viewer own-tenant reads work; foreign-tenant reads empty; valid-input writes to all8new registers42501; money/pack gate denies. Core case insert403, core update filtered with unchanged admin readback, document upload denied; admin upload succeeds.
- Two independent concurrent atomic pack requests produce exactly1winner/1stale-version reject. DBhash equals exact canonical UTF8 bytes. One generation audit. Stale-source failure leaves old draft intact. Approval stamps actual actor, updates case and writes exactly1approval audit.
- Original DUR case retains2intentional flags. Only clearly marked synthetic fixtures were mutated. No real member invitations, shared access, provider or billing changes.

## Reviewed database follow-ups

Applied manually before dependent release, with reported SQL output and own live acceptance:

1. `20261016061500_seed_financial_gate_compatibility.sql`: remove only obsolete seeded money INSERT, preserve existing data/flags/gates.
2. Synthetic viewer role fixture: `scripts/verification/fixtures/20261016-viewer-manual-only.sql`. Manual test setup only, deliberately NOT an automatic migration.
3. `20261016062500_atomic_evidence_packs.sql`: transactional persistence/approval/audits, freshness/version checks, canonical-byte hash, source locks, explicit case/tenant gate.
4. `20261016063000_core_viewer_readonly_guard.sql`: additive restrictive core/storage write guards, existing SELECT policies preserved.

Do not paste or rerun these blindly. Exact-source guards deliberately reject repeats/partial deployment. Source history is not a second apply.

## Disposable database failure tests

`CARGOIQ_PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node scripts/verification/atomic-pack-check.mjs`

Requires separately installed PGlite; does not touch production. Builds full core+nine operational migrations+follow-ups. Forced audit failure rolls back generation/approval/case status; old draft remains. Hash, stale source/version, viewer/foreign tenant, storage and original gates tested. These are not counted as live fault injection or multi-connection substitutes. Live independent-connection races and audit counts were tested separately.

## Limits retained

- Forced production audit failure was not injected into the live database; fault injection passed only in a disposable PostgreSQL-compatible database.
- No shared-recipient field isolation/revocation/load acceptance in this release. No member invitations or50-member launch.
- No live AI provider/external-feed change or WhatsApp activation.
- Clean npm installation has pre-existing peer/lock inconsistencies. Local build/test used existing dependencies plus a temporary no-save plugin-react4.7.0. This release does not rewrite dependency history or claim clean-install CI acceptance.
- Authenticated local UI with live backend is not proof that the public website has published the same commit. Check the actual published app after source merge.
