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
- C: In-app only (current state): the same query rendered on the owner
  dashboard; no email at all.

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
