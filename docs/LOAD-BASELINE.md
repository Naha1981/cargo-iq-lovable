# Load baseline (staging, free Nano, 25 Oct 2026)

Measured from Johannesburg (Africa/Johannesburg) against the eu-west-1 staging
project over the public API. All synthetic data. Scripts: scripts/load-baseline.mjs
(read GETs), scripts/load-upload.mjs (storage uploads, JSONL per-request log).

## Read path (GET /rest/v1/cases?select=id, single tenant JWT, RLS enforced)

| concurrency | requests | ok | p50 | p95 | p99 | throughput |
|---|---|---|---|---|---|---|
| 1 | 30 | 30 | 196 ms | 547 ms | 917 ms | 3.5 rps |
| 5 | 200 | 200 | 186 | 496 | 578 | 21.7 rps |
| 10 | 300 | 300 | 180 | 470 | 544 | 45.7 rps |
| 25 | 500 | 500 | 181 | 476 | 552 | 105.6 rps |
| 50 | 1000 | 1000 | 180 | 570 | 699 | 194.5 rps |

Latency is network-RTT dominated and flat through c50. Zero errors.

## Upload path (POST 100 KB objects to case-documents, tenant JWT)

- Realistic pacing (5 workers, 200 ms stagger, 150 ms between uploads):
  50/50 ok, p50 465 ms, p95 954 ms.
- Burst 10 x 10 on a calm instance: 100/100 ok, p50 445 ms, p95 901 ms.
- Burst 10 x 10 repeated back-to-back: intermittent free-tier saturation -
  ~90% fail-closed 403 "new row violates row-level security policy" (the RLS
  policy check cannot complete under connection pressure) plus ~10%
  429 too_many_connections. Failed uploads left no partial objects visible via storage list/metadata.
Canonical byte-level verification against storage-server internals was NOT
performed; the no-partial-object statement carries that uncertainty.
- 10 MB single-document uploads (realistic evidence size): 3/3 ok at ~2.1-2.3 s.

## What this does and does not show

- Shows: read API headroom is flat to 50 concurrent on the free tier; uploads
  succeed at realistic document sizes and pacing; overload degrades closed
  (errors, no corruption).
- Does NOT show: the 50-CONCURRENT-tenant upload/extraction acceptance bar.
  The burst saturation means the workload shape (how many simultaneous
  uploads, what sizes, what retry behavior) and possibly a queue/backpressure
  design decide whether the free tier can meet it. Extraction under load is
  untested - it needs an AI provider decision (credits = money) or a verified
  fail-closed path. No "50 ready" claim is made anywhere on this evidence.

## Log-level causality evidence (25 Oct 2026, staging unified logs)

Method: Supabase dashboard Logs explorer SQL over edge_logs and postgres_logs,
window 2026-10-25 11:30-13:00 UTC. What the logs prove and what stays open:

PROVEN:
1. The client's burst "403" never crossed the edge as HTTP 403. All-day edge
   403s are only five POST /rest/v1/cases (curl seeding probes, expected).
   The storage server wraps RLS failures in its own error response, so the
   client-visible "403" came from the response body, not the edge status.
2. The denials are real Postgres RLS failures: SQLSTATE 42501, "new row
   violates row-level security policy (USING expression) for table
   \"objects\"", user supabase_storage_admin, the identical parameterized
   storage INSERT that succeeds in calm runs. Denials at 12:42:51-53 UTC,
   immediately after the edge 429 cluster (12:42:46-51 UTC).
3. Postgres did NOT exhaust connections: zero "too many connections" /
   53300 / remaining-slots messages in postgres_logs for the window. The
   429 "too_many_connections" came from a layer in front of Postgres
   (storage server or pooler client limit), not from the DB's 60-conn cap.
4. Pass/deny alternates on identical statements within ONE storage-server
   session (session_line_num 60,61; transaction_id 5068,5069) - so the
   denial is about session state at execution time, not about the object,
   path, bucket, or JWT identity being different.

STILL UNPROVEN (mechanism): why the USING expression evaluates false under
concurrency. Leading hypothesis: request-scoped JWT claims GUC timing inside
the storage server's pooled session. Proving it needs storage-server
internals or a claims-logging repro, not more load runs.

SEPARATE FINDING: a single calm tenant-JWT upload to the cctv-evidence
bucket (12:47:12 UTC) was also denied 42501 - deterministic, not load
related. That is the known user-JWT storage denial, a per-bucket policy
question distinct from the burst race.
