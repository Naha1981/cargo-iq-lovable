# Local batch release gaps

This code batch is local and unpublished. The three new table migrations and
both proposal SQL files were applied once to the separate test project only.
Production remains unapplied. Do not deploy the table migrations alone.

## Test schema (approved revised complete scope, applied to test only)

- Eight new feature tables in three prepared migrations.
- Member-read/investigator-write policies, same-tenant links, no client delete.
- One new automatic audit function with empty search_path, actor/creator binding.
- Four triggers on new entity tables; remove four new audit insert policies.
- One new security-invoker comparison-batch RPC with operation UUID, payload
  fingerprint, advisory transaction lock and same-operation replay.
- No pre-feature tables or functions changed.

Local PGlite proof is not hosted PostgreSQL/authenticated browser acceptance.

## Unmet release gates

Full production build still fails heap allocation at 2GB host capacity. Two
materially distinct experiments (official WebGL-only exports and narrow
geo-layer entry) did not fix it and were reverted. Do not retry heap variations
or push merely for CI. A higher-memory approved existing build environment or
supported dependency graph change must establish a complete build.

Configured application's actual /auth SSR route returned 200 cold/warm. Earlier
throwaway harness SSR hang is not proof that the whole app is broken. Actual
signed-in feature save/reload/access-control acceptance remains unverified.

Converter README discovery is not completed source audit. Named converter
package.json live read 404, direct git unavailable. README describes Gaussian
SPZ GLB, not ordinary b3dm. Dragon fixture only proves ordinary tiles rendering.
No converter installed/executed. Local PLY header checker is not full validation.

Candidate tilesets remain REGISTERED. Syntax acceptance is not successful
rendering, provenance validation, geographic alignment or splat compatibility.
No trusted-ingestion policy for arbitrary nested tile URLs/redirects yet.

Corridor event coordinates are not vessel/shipment tracking positions. Generic
case events retain source/time/provenance but do not become tracking fixes.
Reference corridor geometry is illustrative. No real basemap enabled.

Simulation counts deterministic shared-key candidates and matching evidence;
not validated exposure/physical/financial prediction. Timing, route and contract
inputs are missing for impact calculations. No model weights installed.

GEHI records/report/manual metadata are working locally, not a completed live
historical imagery comparison/correlation service or four pilot validations.

Document links support manual comparisons only, not extraction or contractual
entitlement. Recovery confirmation records operator confirmation, not an
independent bank receipt check. No claims submitted externally.

## Existing build-runner investigation (26 October 2026)

GitHub Codespaces inventory, in an existing signed-in session, lists CargoIQ
"ideal waddle", 2 core / 8GB RAM / 32GB disk, prior branch, no changes:
https://github.com/codespaces/ideal-waddle-pjrjr75q55w9c9wrr

No startup, upload or change performed. Account budgets page shows Codespaces
and Actions each at $0/$0 with "Usage blocked":
https://github.com/settings/billing/budgets
That is a metered-spending ceiling, NOT proof that included runtime is exhausted.
Product-specific remaining included usage remains unverified. Overview aggregate
spend/discount values cannot establish runtime entitlement. Do not change a
budget, start the workspace or transfer the batch without resolving free-only
scope and runtime availability. Existing CI requires push/PR; do not push for CI.

## Archived AIS association

Recorded vessel-name equality produces candidate associations only. Multiple
MMSIs for one matching name withhold that whole candidate group. A single MMSI
is still not a verified case-bound vessel identity. Card age means stored-record
age only, never verified vessel-position freshness or live shipment tracking.

Follow-up included-entitlement read succeeded via Billing "More details":120
included Codespaces core-hours (~$10.80 allowance), $1.72 applied this month;
15GB included storage (~$1.05), $0.83 applied. Product panel reports $2.55
consumed, $2.55 discounted, $0 billable. These approximate dollar values indicate
unused compute entitlement; they are not an exact remaining-hours read. Existing
2core8GB CargoIQ workspace is a viable candidate, not proved unavailable. Owner
approval to resume and non-destructively transfer/run the local batch remains
unresolved. No budget increase or spending approval is the default solution.

Scene viewer now reports metadata-loading/content-loaded states and explicit
metadata/tile failures. Local invalid-JSON candidate fixture reaches readable
error state instead of hanging at loading. Header preflight checks asset.version
and root before mounting the tile layer; this is not a full tileset validator or
nested-fetch/redirect/DNS security policy. No READY promotion occurs.


## Test-database execution and acceptance (26 October2026)

Original revised question15:25, user Build/Yes quote replies15:54. Target verified
through project-bound existing database connection: khuddkzdghdvdhroeoag. Initial
55publictables, target8tables/2functions absent. One transaction applied exact
three migrations and both proposal SQL files. Combined SQL SHA256:
3e41294144d8ac69fd4c9e985bc4250bddc4ce015f033fc0ef4848aee58806ad

Postcheck:8tables RLS enabled,2functions,4triggers,4auditINSERTpolicies absent.
Hosted PostgreSQL synthetic transaction proof passed: actor-bound automatic
audits for all four entities; invalid status transition rollback; client audit
insert refusal; replay returns same IDs with no duplicate audit; changed payload
under same request key refused; malformed batch rolls back fully; viewer read/no
write; foreign-tenant entity/audit isolation. Proof transaction rolled back, no
persistent synthetic proof users/tenants. This is authenticated database-role
proof, NOT browser login/save/reload proof. No customer rows changed.

Approved Codespace build remains unexecuted: cloud browser startup failed initial
and one60secondretry; existing repo/workflow token Codespace read returned403,
requires codespace scope. No scope refresh/newsignin performed. No workspace
started/uploaded and no compute consumed. Needs restored existing session access
or already-scoped existing access, not new budget/spend permission.


## Build gate discharged for v20 only

26October16:23 existing approved2core8GBCodespace built1847e06base+v20patch
SHA25638b1f3a0e448c60787b257faef8395949cd00f4f47c304c95b8f6a7b23bf1272.
Nitro output completed, server build23.87seconds, output/nitro.json present.
Old checkout HEAD0c465a2752b4291a432356f49c27efd9be707575 clean unchanged;
build occurred in separate/tmpdir. No push/publish. Codespace stopped16:24:51,
UIconfirmed already stopped. This supersedes earlier fullbuildOOM/blocker notes
for v20 only. Later historical voice repair has not been production-built.

## Existing voice historical-date repair, local only

Current deployed harbour app matched base byte-for-byte before repair,92290bytes
SHA25605c67eaf277e327b6fd04093bced7c22730aab7be906e37cb5839ed4d0b87ce3:
https://cargoiq.nahalabs.co.za/harbour-view/assets/app.js
Existing browser speech capture and place commands were present. Historical date
parsing was not; replay targeted a fictional case. This is repair of incomplete
existing voice behavior, not a new feature request. Original18Oct voice-control
instruction recovered; exact older date-example instruction not yet recovered.

Local repair intercepts historical intent before live actions/external TTS/logs,
requires explicit place/date review, uses SAST recorded event day, bridges only
current authenticated case timeline coordinates from the same-origin parent,
and lists nearby records or explicit missing/unconnected evidence state. Map
camera action and selected date do not imply loaded imagery/footage or terminal
identity. Live markers are hidden during historical review including new updates.
No ingestion-time fallback. Microphone security policy unchanged. Local extracted
controller pixels/tests are not actual live microphone/app acceptance. Full
static-map browser harness has not been proven; do not report voice repair live.

Historical review follow-up: native numeric date is paired with plain-language
3 December 2025, candidate reference-place wording and alternative selector.
Actual full static Harbour DOM in lite mode now passes with provider calls blocked,
showing disconnected evidence and synthetic timestamped record cases. A preexisting
mobile MutationObserver self-loop was found: adding an already-present hidden
class repeatedly starved the page once voice panel opened. Guarded that mutation.
This is full static DOM/controller proof, not real Cesium rendering, speech capture
or authenticated parent-loader acceptance. No full production build after v20.

v23 historical follow-up: real Cesium (not lite or stub) loads in local Chrome
and moves camera to confirmed candidate reference place, real existing Esri base
imagery rendered. This is NOT historical imagery or terminal identity proof.
Persistent map banner identifies selected date, candidate place, basemap-not-from-
selected-date, and hidden live markers even after the voice panel closes. Pixels
inspected at390x900. Same-origin iframe onLoad handshake added to close the fast-
child/effect race. Late snapshot response cannot override explicit historical
review. New incoming evidence clears stale review list and asks reapply. Actual
speech capture remains untested under existing microphone=() security policy;
no policy relaxed. Existing session browser startup unavailable twice with60s
bounded retry, so Lovable wiring and authenticated app-loader acceptance remain
unverified. v22whole suite455pass+expectedfail+skip, v23focused10pass/tsc0.

v24 state-boundary correction: historical review is isolated from live conditions,
time scrub, risk, reconstruction and fictional replay until explicit exit. Prior
snapshot responses cannot replace selected review. Refresh clears stale evidence
and requires reapply. Local tray historical records are deliberately TEXT ONLY,
with selected-date/candidate coords/IDs/not-historical-basemap/not-verified-identity
metadata and source/limits persisted. They are NOT saved to authenticated case
pack. Open pack during review reports this boundary; no automatic attachment.
Real Cesium mobile pixels inspected for local tray and reference map. Public root
response microphone=() confirmed; standalone static response lacks this header.
No microphone invocation or security policy change. Authenticated case effective
browser permissions/real parent loader still unverified.
Latest whole suite455pass+1expectedfail+1skip,64files;tsc0. No fullbuild afterv20.

v25 SOURCE-PRESERVATION SAFETY: four unfinished database-backed workspaces
Recovery/Scene/Geospatial/Simulation default to not-activated UX. Their server
handlers independently fail closed before database reads/writes. No env flag,
client state or successful table read enables them. Complete environment-specific
schema/audit validation and authenticated acceptance remain required future work.
This gate is deliberately OFF everywhere, including staging, until that work is
done. Corridor and existing Harbour/voice paths are not gated. No production
schema, settings or release env changed. This prevents unknown main-sync from
silently exposing nonfunctional mutation forms. It is NOT feature completion.
Whole lint0errors/7existingwarnings,tsc0. After gate addition the inner-permission suite initially failed because the new gate refuses earlier. Those tests now explicitly mock hypothetical activation; independent gate tests prove default refusal. Final suite result reported separately.
Fullproductionbuild still v20only; current8GBpath unavailable because browser
startup initial+single60sretry failed, no genuine restoration signal afterward;
CLI Codespaces read403 requires a new scope, which was not requested or changed.

Latest16:47 geospatial mandate is AUDIT ONLY. No SAM/segmentation/dated-imagery implementation added. Existing earlier metadata-only GEHI source remains disabled behind default-off route/server gate for source preservation, not activation. New mandate requires separate blueprint and user approval before implementation.
