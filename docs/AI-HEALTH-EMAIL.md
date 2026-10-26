# Daily AI / extraction health email - design and draft (SEND DISABLED)

Acceptance criterion: "graceful degradation + daily AI health email".
This document is the design plus the exact content draft. **No email is sent
by this change.** Sending requires the owner's explicit grant covering sender
identity, recipient, content scope, and cadence; until then the report is only
computed and viewable inside the app.

## What the report measures (no AI calls, no spend)

Everything below is computed from data the system already stores. Generating
the report makes zero calls to any AI provider and costs nothing.

1. **Extraction completeness (per 24 h and rolling 7 d)**
   - Documents by `documents.extraction_status`: COMPLETE / INCOMPLETE /
     UNKNOWN. INCOMPLETE means a provider call was partial or failed;
     UNKNOWN means status was never recorded (legacy rows).
   - Discrepancy-review coverage: MODEL_FAILED / MODEL_NOT_RUN counts. These
     are the graceful-degradation signals: the product already tells users
     "no flags does not mean no discrepancies exist" in these states.
2. **Failures**: rows in `app_errors` (bounded table) grouped by code, top 5.
3. **Free-tier cap pressure**: how close the daily free-extraction cap
   (see `free_extraction_daily_cap` migration, config-not-code) came to its
   limit, per day. Hitting the cap is a degradation event, not an error.
4. **Pipeline liveness**: newest document row, newest app_errors row. Silence
   is reported as silence ("no extractions attempted"), never as "healthy".

## Content rules (privacy)

- Counts and statuses only. No claim text, no document names, no tenant
  names, no user identifiers. Aggregated across all tenants.
- The email must stand alone as safe to forward; assume it can leak.

## Delivery mechanism options (free tier, decision pending)

- A: `pg_cron` + `net.http_post` to an edge function that composes and sends.
  Availability of `pg_cron`/`pg_net` on the free Nano tier is NOT yet
  verified - must be checked on staging before choosing this.
- B: External cron (GitHub Actions schedule, free for public repo usage
  limits) calling a send endpoint guarded by a shared secret.
- C: In-app only (IMPLEMENTED 25 Oct): `admin_get_ai_health()` RPC
  (migration 20261025210000, in-DB platform-admin authorization) +
  `getPlatformAiHealth` server fn + owner admin panel, all rendering the
  shared `composeAiHealthText` composer with unit tests; no email at all.
  NOTE: option C does NOT satisfy the "daily AI health email" acceptance
  criterion - that requires a granted sender and a chosen delivery mechanism.

## Send path prepared (25 Oct, send DISABLED)
- src/lib/ai-health-email.ts: gating (CLAIM_HEALTH_EMAIL_ENABLED=1 AND
  CLAIM_HEALTH_EMAIL_TO AND RESEND_API_KEY - all three or nothing sends),
  payload = the shared composeAiHealthText verbatim, send through the
  EXISTING NahaLabs Resend account (no new sign-up; free tier; no paid AI).
  Every non-send state is returned, never hidden. 12 unit tests.
- POST /api/health-email (src/routes/api/health-email.ts): the actual safe
  scheduled invocation. DISABLED answers before any credential, auth or DB
  touch, so pointing a cron at it pre-grant is harmless. When enabled, an
  external cron (or pg_cron) POSTs with the existing LOVABLE_CRON_SECRET
  bearer (current+previous rotation, timing-safe compare).

## Duplicate-send protection (bounded - NOT an exactly-once guarantee)
A read-before-send marker cannot even approach one-send-per-day: concurrent
invocations both pass the check, a provider-accepted send whose response is
lost looks unsent, and a failed marker write after a successful send causes
a resend. The implementation reduces duplicate-send risk with two bounded
mechanisms and an honest unknown state; it does NOT guarantee exactly-once
delivery (the provider idempotency window is 24h and unknown outcomes exist):
1. **Atomic day claim** (migration 20261025240000, table health_email_sends,
   one row per UTC day, PRIMARY KEY; claim via INSERT ... ON CONFLICT DO
   NOTHING with a bounded 5-minute sending lease). Two concurrent invocations
   can never both hold the lease (PGlite-proven).
2. **Provider idempotency**: the Resend Idempotency-Key header is the UTC day
   (cargoiq-health-email-YYYY-MM-DD); a same-day retry returns the original
   response WITHOUT sending again (Resend keys live 24h).
3. **No automatic resend of unknown outcomes**: an expired lease, a provider
   rejection or any unconfirmed send leaves the day row in a visible
   'unknown'/'send_failed' state. The endpoint answers unknown_needs_review
   (HTTP 409). app_errors is NOT used as the delivery ledger.

## Owner-readable delivery state (in-app, no SQL needed)
The owner admin panel ("Daily AI / extraction health", src/routes/admin.tsx ->
AdminAiHealthPanel) renders a "Health email delivery" section from
admin_list_health_email_sends (migration 20261025240000, platform admins +
service role only; PGlite-proven FORBIDDEN for anyone else). Every non-'sent'
day is highlighted "needs owner review". A send whose confirmation write fails
after provider accept answers sent_confirmation_failed (HTTP 502), leaves the
day to expire into 'unknown', and is surfaced there - never silently clean.

## Manual retry rules (no exactly-once guarantee beyond 24 h)
The Resend idempotency window is 24 HOURS from the first attempt. A manual
retry of a day in 'unknown' is only safe when BOTH hold:
  1. less than 24 h elapsed since the first attempt of that UTC day, so the
     day key (cargoiq-health-email-YYYY-MM-DD) still dedupes at the provider;
  2. OR the owner has confirmed the actual outcome in the Resend dashboard
     (Logs) for that day - if it shows the email was delivered, do NOT resend;
     mark the day row 'sent' manually instead.
After 24 h without provider confirmation there is no safe automatic path:
the owner decides, knowing a duplicate is possible.
PGlite proofs: scripts/health-email-claim-test.mjs (9 checks: concurrent
claims single winner, confirmed send -> already_sent, expired lease ->
unknown forever, failed send -> owner review, no late overwrite, client roles
locked out of the ledger, admin reads delivery state, non-admin FORBIDDEN,
service_role allowed).

- Still needed, each owner-approved: the enable grant itself, the recipient
  address, RESEND_API_KEY in the deploy env, and a daily trigger (pg_cron or
  external cron - a separate live change). Until then the daily-email
  acceptance stays OPEN.

Recommendation: verify A on staging first; B is the fallback. C is live today
in degraded form (the owner can query the statuses manually).

## Draft content (for approval; will not send without grant)

Subject: CargoIQ daily health - <date>: <N> extractions, <M> incomplete, cap <P>%

Body (plain text):

> CargoIQ extraction health for <date> (UTC):
> - Documents processed: <N> (COMPLETE <a>, INCOMPLETE <b>, UNKNOWN <c>)
> - Discrepancy review: ran <r1>, not run <r2>, failed <r3>
> - Free daily extraction cap: <used>/<limit> (<P>%)
> - App errors (24 h): <E> total; top: <code xN, code xN>
> - Quiet period note: if counts are zero, nothing was attempted - that is
>   not an all-clear.
> This email contains aggregate counts only: no tenant data, no document
> content.

## What is NOT in scope

- Provider latency/cost metrics: no paid provider is active, so there is
  nothing to measure. When a provider is activated (a money decision), its
  latency and failure-rate columns get added to the same report.
