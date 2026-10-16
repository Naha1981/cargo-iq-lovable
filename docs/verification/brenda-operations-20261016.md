# Operational release verification - 16 October 2026

## Scope

Integrates staged operational PRs9/10/11/12/14/15/17 onto current main. Dedicated Definitions and Clocks tabs, appointment attribution, per-party KPIs, human event matches and identity review history, evidenced resolutions, reconciliations, evidence gaps, frozen JSON/PDF exports. Shared workspace remains excluded. WhatsApp remains on separate draft PR21 and OFF.

## Verified

- Vite/Nitro build, strict TypeScript,17test files:63passed,1existing skipped.
- Authenticated production REST against clearly marked synthetic QA case: actual private source upload/hash; append-only definition versions; stale writes; two concurrent writes produce exactly one winning version; wrong-case source rejection.
- Source offset/timezone coherence;12h outside queue vs2h inside terminal; incompatible clock sources block financial/pack inserts; evidenced clock choice freezes source IDs; later source invalidates previous choice.
- Appointment issuer vs claim target preserves attribution without liability verdict.
- Controlled cross-document same-event timestamp conflict creates a real FLAGGED contradiction; duplicate and reversed pairs reject; identity retraction alone does not clear flag; blank resolution rejects; evidenced resolution audits.
- Evidence gap source-count rules; KPI missing evidence and no universal benchmark; financial append-only writes; frozen pack payload immutability and approval.
- Actual staged app server function creates canonical pack against live QA backend. JSON carries all8operational/history registers. PDF downloaded and all3pages visually inspected.
- Actual authenticated local app desktop and390px mobile pixels inspected. No mobile horizontal overflow. This is not a deployed public-site acceptance test.
- Disposable PostgreSQL-compatible local test: viewer append denied, cross-tenant select denied, forced operational-definition audit failure rolls back its insert. These are not counted as live multi-user acceptance.
- Original DUR case retains2intentional flags. No real member invitations, recipient grants, shared-workspace activation, provider or billing changes.

## Release/readiness holds

1. New organization provision fails when old demo seed tries to insert financial run into flagged case. Minimal exact-source-guarded seed patch supplied separately for SQL-editor review. Live fix not yet confirmed. Existing flagged cases and gates must remain untouched.
2. Real authenticated second-tenant and viewer tests await provision fix and narrow synthetic viewer fixture setup. Do not replace with local RLS tests.
3. Existing pack generation/approval uses several REST calls instead of one transaction. Audit errors are ignored; draft supersession occurs before new insert succeeds. Full pack/audit rollback acceptance is not satisfied. Needs reviewed transactional migration and real acceptance.
4. Clean npm installation has pre-existing peer/lock inconsistencies; local validation used existing installed dependencies plus a temporary no-save plugin-react4.7.0. No lock/dependency rewrite included.
5. No claim of production readiness, member rollout readiness or shared-workspace readiness. Staged UI/server integration is for review while these gates remain open.

## Other notes

RLS-filtered PATCH/DELETE can return200with an empty array. Denial tests also re-read the row and verify unchanged content, rather than requiring HTTPerror alone. Synthetic QA audit/history is retained; immutable rows are not removed to tidy test results.
