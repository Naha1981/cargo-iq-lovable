# CargoIQ WhatsApp lane quote foundation
16 October 2026. Local source delivery, NOT a deployed or live messaging feature.

## Release boundary
- Official direct Meta Cloud API route only. No linked-device library/BSP.
- `CARGOIQ_WA_TEST_INGEST` defaults OFF. GET/POST endpoint returns404 before reading credentials or touching DB.
- DB channels default DISABLED; supported modes only DISABLED/TEST. No registration/activation UI or RPC.
- There is NO outbound sender, access token reader, paid AI/maps call or Graph API send. Outbox schema structurally permits only DRAFT; test webhook does not even create an outbox row.
- No live Meta assets were created, no test number claimed, no OTP attempted, no external reply sent, no production SQL applied. Future test-number setup needs real account access and parent-coordinated authority; 'use test numbers' is a development route, not a claim they are provisioned.
- Existing CargoIQ case/evidence/privacy features untouched. No real rates or fixtures are seeded.

## Integration
1. Review `supabase/migrations/20261016054000_whatsapp_quote_foundation.sql` against target staging. This is separate from the15October nine-migration rollout, not a replacement or prerequisite. Apply only after core `tenants`, `user_roles`, `auth.users` exist. Do not replay on partial deployment. Audit actual PostgreSQL migration history and backup first.
2. Add the source files at their exact paths. They are new files only. Existing auth tenant middleware and generated route-tree tooling are reused. Regenerate route tree with normal app dev/build, never edit generated tree manually.
3. Real app build/typecheck/test and deployed Tailwind/pixels remain necessary. This delivery's esbuild test checks eight source entrypoints, not a full app release. Admin source route `/whatsapp-quotes` has no public-nav link and requires tenant admin middleware + RLS/RPC checks. Existing investigator/viewer roles cannot read the commercial rate tables.
4. Keep `CARGOIQ_WA_TEST_INGEST` unset/false. No other environment flag can turn on outbound; sender deliberately absent.
5. In a later authorized dev setup use Meta's free test number, verified test recipient, and test channel only. Configure server-only `WA_META_APP_SECRET`, `WA_WEBHOOK_VERIFY_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY` with the target project URL through secure secret storage. No real business number migration/deregistration. Do not commit secrets. No Graph token is needed by this foundation since it never sends.
6. A reviewed operator-only DB step may create a TEST channel for a verified Meta test phone_number_id. There is deliberately no canned INSERT against any actual phone. Test ingest enablement must be separately authorized; it is not performed by this package.
7. Test signature/header handshake and text webhook, confirm one request/snapshot across retries. Keep activation held until approved number, disclosable real rate card, reply wording/scope, cost controls and a real round-trip acceptance exist.

## Engine semantics
- Strict text grammar covers one city-to-city lane, positive integer kilograms or tonne conversions, and tautliner. Supports Johannesburg/JHB, Durban/DBN, Cape Town/CPT, Pretoria/PTA. No extra stop, date, address, dangerous-goods condition, multiple weight, unsupported city or equipment is silently discarded. Unsupported text goes to review, never a guessed quote.
- Price is fixed one-way load amount (not per-tonne/per-km), inclusive min/max kg bands. Effective start inclusive/end exclusive. ZAR only; explicit VAT treatment and rate. EXCLUDED VAT added with integer-cent rounding. INCLUDED/NOT_APPLICABLE add nothing. No inferred market price, carrier availability or liability.
- Rates, imports and revocations append-only. Atomic import and serialized overlapping-rate guard; no silent cheapest selection. Revoke an entire mistaken batch with reason before importing replacement. Historical snapshots remain unchanged. Current rate rows RPC filters revoked batches.
- Owner must supply real rates with permitted customer disclosure and explicit terms, exclusions, effective instants and validity hours. CSV header below. No synthetic sample CSV is supplied for import; numeric values in tests/visual harness are unmistakably synthetic.
- Simulator returns a DRAFT - NOT SENT indicative price/clarification and never persists a booking or sends anything. Draft wording is provisional and is NOT approved customer communication.

## CSV columns
`version,origin,destination,equipment,min_kg,max_kg,amount_minor,currency,vat_treatment,vat_bps,valid_from,valid_to,validity_hours,terms,exclusions,source_reference,disclosure_approved`
- City codes JHB/DBN/CPT/PTA; TAUTLINER; ZAR.
- Whole minor currency units, e.g.100 cents = ZAR1, not a market rate suggestion. VAT basis points e.g.1500 means15%, only when actually approved.
- UTC timestamps such as YYYY-MM-DDTHH:mm:ssZ; ISO UTC actual dates.
- Every row `disclosure_approved=true`; not an assertion we can make for the user.
- Up to500 rows/200KB; quoted commas supported, multiline terms rejected, bad row/overlap rejects all. UI previews source terms and requires disclosure confirmation.

## Security and reliability
Webhook verifies HMAC-SHA256 over bounded raw body before interpreting events. Test phone-number ID maps to DB tenant, never caller text or forwarded original phone. Media not fetched. Old/future events ignored; authenticated-only service RPC enforces age, per-channel/per-sender throttle, channel lock and unique wamid. Atomic snapshot save idempotent. Status-only events never create requests. Signature proves transport, not authority for user-written commands. Messages are input data only; strict parser cannot retrieve private case data.

Foundation limitation: test statuses are ignored, not a complete delivery-receipt reconciliation system. Durable inbound records/snapshots exist, but no background worker or retry daemon is provisioned. No claim of exactly-once external delivery is possible here since no sends exist. Before a sender is added, implement free-allowance reservations, receipt reconciliation,24-hour gate, opt-out, a durable worker and uncertain-send handling. Never blind-resend an ambiguous timeout.

## Free use and activation
Meta official FAQ at https://whatsappbusiness.com/resources/faq/ says effective1October2026 first1,000 service messages/business number/month free;1,001st billable. This supersedes older unlimited-free text on the pricing landing page. All clarification/error replies would consume allowance. No billable templates/marketing. A later free-only sender must fail closed before threshold and account for ALL other senders on the number; existing server/DB quotas and any number/SIM cost must be checked. No unlimited-free or production-availability claim.

## Verification
`npm install` then `npm test`, `npm run build`, `node verification/schema-check.mjs`.
- Vitest engine/CSV/webhook fixture tests.
- PGlite SQL tests use disposable auth/core stubs, not actual Supabase/PostgREST/networked concurrency/load proof.
- Local React visual harness + Chrome inspected desktop390px mobile, synthetic quote, missing-rate and CSV preview states. Public app CSS snapshot used to approximate current styling; deployed Tailwind may differ. Harness is separate from app routes and must not be shipped publicly.
- Package excludes node_modules and bulky generated harness assets. Tests contain only fictional local fixture values. Rebuild visual harness if needed using the source script and esbuild alias.

## Remaining gates before a live claim
Actual staging migration + authenticated REST role tests; real app build/typecheck; deployed desktop/mobile pixels; approved number and rates/reply scope; Meta assets/permissions/webhook proof; cost-cap/receipt/worker implementation; real verified test message -> approved price -> delivered WhatsApp reply; staged rollback/disable exercise. No claim that this foundation replies on WhatsApp yet.

Type check used for pure modules:
`tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler src/lib/whatsapp/quote-engine.ts src/lib/whatsapp/rate-csv.ts src/lib/whatsapp/rows.ts`

Numbers use a decimal dot only. Comma-formatted numbers such as10,000kg are rejected as ambiguous, not silently interpreted as10kg.
