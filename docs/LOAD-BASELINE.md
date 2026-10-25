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
  429 too_many_connections. Failed uploads left no partial objects.
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
