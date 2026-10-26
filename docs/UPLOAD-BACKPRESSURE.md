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

### 1. Client-side bounded concurrency (day one, zero infra) - IMPLEMENTED
The upload UI sends at most 2 files concurrently per session and queues the
rest locally. Rationale: a single user cannot burst the pooler alone; the
measured failures came from multi-client bursts. This is a UX cap, not a
security boundary.

### 2. Idempotency by content hash (day one, already have the primitive) - IMPLEMENTED
`documents.sha256_hash` is already stored and displayed. Before insert, hash
the file client-side and look up (tenant_id, sha256_hash) within an open
upload window (e.g. 15 min): a hit returns the existing row instead of
inserting. Makes every retry of the same file a no-op. The registerDocument server fn now returns the existing row for a
same-hash re-upload within 15 min and removes the duplicate storage object
via the service-role path (25 Oct). A partial unique index on
(tenant_id, sha256_hash) would additionally enforce it under races - needs a
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

### 4. Failure UX contract - IMPLEMENTED
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

## Log evidence update (25 Oct 2026)

Postgres did not run out of connections during the failing bursts (no 53300
in postgres_logs); denials are RLS USING-expression failures by the storage
server's own session, alternating with successes on identical statements.
This STRENGTHENS the case for admission control in front of storage (fewer
concurrent storage-server transactions -> fewer chances to hit the race),
but it does not prove the semaphore fixes the root cause: the semaphore
bounds blast radius and makes rejection explicit, root cause stays open.

## Implementation status (25 Oct, corrected after review)
- Client: sequential upload loop (never more than one concurrent upload per
  SESSION - this is a per-client UX cap, NOT aggregate admission control for
  the 50-concurrent question; only the server semaphore bounds aggregate
  load). One automatic retry after 2 s of 429/5xx/network failures only.
  Burst 403s are NOT auto-retried: their causality is unresolved, and a
  permanent authorization failure must never be retried as transient.
  Exhausted retries render "Upload was not confirmed - the file may not have
  been saved. Check the document list before retrying." We do not claim
  "nothing was saved" (a lost response is ambiguous) and we do NOT claim
  retrying is unconditionally safe: the concurrent same-content window and
  the cleanup check-then-delete TOCTOU stay open until the owner-gated
  unique index lands. Policy seam src/lib/upload-backpressure.ts with unit
  tests.
- Server: registerDocument sequential-retry idempotency - a same-content
  re-upload within 15 min returns the existing row and removes THIS attempt's
  object. The removal runs its reference check through the service role
  across ALL tenants (a tenant-scoped RLS query is blind to other tenants'
  rows pointing at the same object), deletes ONLY when no row references the
  path, and NEVER deletes on an unknown (errored) reference check. Failures
  are retained in app_errors (owner-visible) and logged, not hidden. The
  check and delete are not atomic (TOCTOU) until the unique index provides
  committed-row atomicity; until then the check errs toward keeping objects.
  Failed inserts run the same reference-checked cleanup before surfacing
  the error.
- The idempotency read-window alone does NOT close the concurrent
  same-content race; only the owner-gated partial unique index does.
- The pre-existing ~35 MB of orphaned staging objects are NOT removed by
  this change; no supported removal path exists once their rows are gone.
- Server admission semaphore (migration 20261025220000, CODE-PREP ONLY - not
  applied anywhere): lease-row semaphore serialized by one advisory lock so
  check-and-insert is atomic. Cooperative pre-PUT acquire by the client plus
  registration-time lease verification (a registration without a live lease
  is refused even if a client skips acquire). TTL (default 300 s) backstops
  crashed clients. Owner-settable without a deploy: env defaults
  CLAIM_UPLOAD_TENANT_CONCURRENCY (default 3), CLAIM_UPLOAD_GLOBAL_CONCURRENCY
  (default 25), CLAIM_UPLOAD_SLOT_TTL_SECONDS (default 300), plus per-workspace
  DB overrides via admin_set_tenant_upload_concurrency (NULL inherit /
  0 disabled / 1..100 bound). Unconfigured (NULL everywhere) is explicitly
  UNBOUNDED and shown as such, never silently treated as bounded.
  Scope honesty: this gates the app's upload pipeline only - it cannot gate
  raw storage-endpoint traffic outside the app. Deploy ordering: apply the
  migration BEFORE deploying this code; acquire/verify fail closed when the
  RPCs are missing (uploads refuse with UPLOAD_ADMISSION_UNAVAILABLE).
  PGlite proof: scripts/upload-admission-test.mjs (9 checks).
- Unique object-ownership invariant (migration 20261025230000, CODE-PREP
  ONLY - not applied anywhere): partial unique index on
  documents(tenant_id, case_id, sha256_hash) closes the concurrent
  same-content race at the database: the loser's insert fails 23505 and
  registerDocument surfaces that constraint error to the caller. NOTE
  (corrected 2026-10-26): there is NO code-side winner-return branch -
  an earlier version of this paragraph claimed registerDocument "returns
  the committed winner", which the code does not implement; the actual
  concurrent-duplicate user outcome is an error surfaced on the losing
  upload, and only the DB invariant guarantees single ownership. The
  migration fails loudly if live duplicates
  exist (never dedupes silently); NULL hashes never collide; deleting a row
  frees the content. PGlite proof: scripts/documents-content-unique-test.mjs
  (6 checks).
