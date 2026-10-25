# Upload-path backpressure and retry design (free tier)

Trigger: 25 Oct 2026 staging measurements (docs/LOAD-BASELINE.md). Read GET
load is flat to 50 concurrent (p95 570 ms). Uploads at calm concurrency are
fine (c5 paced 50/50, c10x10 single burst 100/100 at 100 KB). Back-to-back
10x10 bursts intermittently fail closed: ~90% HTTP 403 "new row violates
row-level security policy" and ~10% HTTP 429 too_many_connections, with zero
partial objects. **Causality is unresolved**: the 403 and 429 co-occur and no
server logs have been inspected; do not treat connection pressure as proven.

Official free-Nano envelope being defended: 60 direct DB connections,
200 pooler clients, 5 MB/s disk, 0.5 GB RAM (supabase.com compute-and-disk).

## Design goals

1. Never fail silently. A rejected upload tells the user exactly that it was
   not stored and that retrying is safe.
2. Never store partial state. (Measured today: fail-closed already holds -
   no partial objects after failed bursts.)
3. Bound concurrent upload work per service so a burst queues or rejects
   fast instead of piling onto the pooler.
4. Retries are idempotent: retrying the same file must not duplicate rows.

## Proposal (free only, config-not-code)

### 1. Client-side bounded concurrency (day one, zero infra)
The upload UI sends at most 2 files concurrently per session and queues the
rest locally. Rationale: a single user cannot burst the pooler alone; the
measured failures came from multi-client bursts. This is a UX cap, not a
security boundary.

### 2. Idempotency by content hash (day one, already have the primitive)
`documents.sha256_hash` is already stored and displayed. Before insert, hash
the file client-side and look up (tenant_id, sha256_hash) within an open
upload window (e.g. 15 min): a hit returns the existing row instead of
inserting. Makes every retry of the same file a no-op. Add a partial unique
index on (tenant_id, sha256_hash) where created_at is recent - needs a
migration (live-apply packet, owner's gate).

### 3. Server-side admission control (the actual backpressure)
A small Postgres semaphore via `pg_try_advisory_xact_lock(hashtext('upload'))`
at the start of the upload handler with N slots (N configurable, start at 8 -
well under the 60-connection ceiling so reads keep headroom). No slot ->
immediate 503 with `Retry-After: 2` and a body stating the upload was NOT
stored. This bounds server-side concurrent insert+storage work regardless of
client count. Verify on staging that advisory locks work through the
transaction pooler (transaction-mode pooler + xact lock is compatible by
design; session-mode would need the non-xact variant).

### 4. Failure UX contract
- 503/429/403 from the upload path renders: "Upload not stored - nothing was
  saved. Retry." with an automatic single retry after the Retry-After delay,
  then manual.
- The document list must never show a row whose storage write failed
  (rollback on storage failure already uses the service-role delete path,
  verified 25 Oct 2026).

### 5. What this does NOT claim
- It does not make 50 concurrent uploads "supported". It makes overload
  bounded, explicit, and retry-safe. The 50-tenant concurrent workload vs an
  AGREED response-time target remains its own acceptance question; paced
  results are not a substitute.
- Burst-403 causality stays open until server logs / exact JWT-bucket-policy
  inspection is done; the semaphore bounds the blast radius either way.

## Verification plan (staging, synthetic only)
1. Rerun scripts/load-upload.ts (repo) with semaphore off/on at c10x10
   back-to-back x3: record status-body histograms. Pass = no silent partials
   and rejections carry Retry-After.
2. Same file uploaded twice concurrently -> one row, one object.
3. Advisory-lock behaviour confirmed through the pooler on staging.
