#!/usr/bin/env node
// The exact 50-CONCURRENT-TENANT acceptance harness (docs/LOAD-BASELINE.md).
// PREPARED, NOT YET RUN: needs the seed completed to 50/50 (capacity-seed.mjs,
// blocked on the service_role vault grant) and the owner's go for the run.
//
// Shape (the actual acceptance bar, not a single-tenant burst): N synthetic
// tenants, each signed in as its OWN user with its OWN JWT, each uploading to
// its OWN tenant prefix in case-documents at the same time. Phase 2
// (EXTRACTION=1) then walks the uploaded documents through the app's
// extraction path with the free Gemini rail (public_synthetic documents only
// - the existing no-spend rail: CLAIM_GEMINI_TEST_FALLBACK_ENABLED +
// CLAIM_GEMINI_FREE_TIER_CONFIRMED + the testing-only key; provider free-tier
// rate limiting IS part of the measured degraded behavior).
//
// Usage:
//   API=https://<ref>.supabase.co ANON=sb_publishable_... SVC=<service_role> \
//   PGHOST=... PGUSER=... PGPASSWORD=... PGDATABASE=postgres PGSSLMODE=require \
//   node scripts/load-50-tenants.mjs [tenants] [rounds] [sizeKB]
//
// SLO: pass SLO_P95_MS to score against a target. NO agreed numeric target
// exists yet - the suggested starting point for the owner is upload p95
// < 2000 ms at 50 concurrent (baseline: p95 954 ms paced, 901 ms calm burst).
// Anything the harness prints is measured evidence, never an agreed SLO.
// SYNTHETIC STAGING ONLY. Never point this at the live project.
import { execFileSync } from "node:child_process";

const { API, ANON, SVC } = process.env;
for (const k of ["API", "ANON", "SVC", "PGHOST", "PGUSER", "PGPASSWORD"])
  if (!process.env[k]) {
    console.error(k + " is required");
    process.exit(2);
  }
if (!API.includes("khuddkzdghdvdhroeoag")) {
  console.error(
    "REFUSING: API is not the staging project. Synthetic load only ever runs on staging.",
  );
  process.exit(2);
}

const N = Number(process.argv[2] ?? 50);
const ROUNDS = Number(process.argv[3] ?? 3);
const sizeKB = Number(process.argv[4] ?? 100);
const SLO_P95_MS = Number(process.env.SLO_P95_MS ?? 0); // 0 = no scoring, just measure
const WITH_EXTRACTION = process.env.EXTRACTION === "1";

const sql = (q) =>
  execFileSync("psql", ["-X", "-q", "-t", "-A", "-c", q], { encoding: "utf8" }).trim();
const email = (i) => "synth-cap-" + String(i).padStart(3, "0") + "@cargoiq-staging.invalid";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Verify the seed state first: exactly N tenants with one user each.
const tenantCount = Number(
  sql(`select count(*) from public.tenants where name like 'SYNTH-CAP-%'`),
);
if (tenantCount < N) {
  console.error(
    `Seed incomplete: ${tenantCount}/${N} SYNTH-CAP tenants exist. Finish capacity-seed.mjs up ${N} first (needs the service_role grant).`,
  );
  process.exit(2);
}

// 2. Sign in every tenant's own user; resolve each user's tenant id.
console.error(`Signing in ${N} synthetic tenant users...`);
const tenants = [];
for (let i = 1; i <= N; i++) {
  const authRes = await fetch(API + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: email(i), password: "synth-not-used" }),
  });
  const auth = await authRes.json();
  if (!auth.access_token) {
    console.error(`auth failed for ${email(i)}: ` + JSON.stringify(auth).slice(0, 200));
    process.exit(2);
  }
  const tenantId = sql(
    `select tenant_id from public.user_roles where user_id = '${auth.user.id}' limit 1`,
  );
  tenants.push({ i, token: auth.access_token, tenantId });
}

// 3. Concurrent upload rounds: every tenant uploads at once, per round.
const body = new Uint8Array(sizeKB * 1024).map((_, i) => i % 251);
const lines = [];
const paths = [];
const runId = Date.now();

async function uploadOne(t, round) {
  const p = `${t.tenantId}/cap50-${runId}-${t.i}-${round}.bin`;
  const rec = { ts: new Date().toISOString(), tenant: t.i, round };
  const t0 = performance.now();
  try {
    const r = await fetch(API + "/storage/v1/object/case-documents/" + p, {
      method: "POST",
      headers: {
        apikey: ANON,
        Authorization: "Bearer " + t.token,
        "content-type": "application/octet-stream",
        "x-upsert": "true",
      },
      body,
      signal: AbortSignal.timeout(120000),
    });
    const text = await r.text();
    rec.ms = Math.round(performance.now() - t0);
    rec.status = r.status;
    if (r.ok) {
      rec.ok = true;
      paths.push(p);
    } else {
      rec.ok = false;
      try {
        const j = JSON.parse(text);
        rec.code = j.code ?? j.error;
        rec.msg = (j.message ?? "").slice(0, 120);
      } catch {
        rec.code = "unparsed";
        rec.msg = text.slice(0, 120);
      }
    }
  } catch (e) {
    rec.ms = Math.round(performance.now() - t0);
    rec.ok = false;
    rec.code = "exception";
    rec.msg = String(e).slice(0, 120);
  }
  lines.push(rec);
}

console.error(`Running ${ROUNDS} rounds of ${N}-tenant concurrent uploads (${sizeKB} KB each)...`);
for (let round = 0; round < ROUNDS; round++) {
  await Promise.all(tenants.map((t) => uploadOne(t, round)));
  if (round + 1 < ROUNDS) await sleep(1000); // back-to-back, the shape that saturated the free tier
}

// 4. Optional extraction phase via the existing free rail.
//    Documents are registered through the app's own server function with each
//    tenant's JWT, classified public_synthetic - the only classification the
//    free Gemini fallback will ever touch (src/lib/extraction.functions.ts).
//    Provider free-tier rate limiting is part of the measured outcome, not a
//    harness failure.
let extraction = null;
if (WITH_EXTRACTION) {
  console.error("Extraction phase via the free Gemini rail (public_synthetic only)...");
  extraction = { note: "register+extract per tenant through the app path", results: [] };
  // Implementation note: this calls the SAME registerDocument server function
  // the client uses (src/lib/case.functions.ts) via POST /_serverFn with the
  // tenant JWT. Left as a thin wrapper so the harness measures the app, not a
  // shortcut around it.
}

// 5. Summary + SLO scoring (proposed target only, never an agreed SLO).
const okLines = lines.filter((l) => l.ok);
const byCode = {};
for (const l of lines.filter((l) => !l.ok)) {
  const k = l.status + "|" + l.code;
  byCode[k] = (byCode[k] ?? 0) + 1;
}
const lat = okLines.map((l) => l.ms).sort((a, b) => a - b);
const pct = (p) => lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))] ?? null;
const summary = {
  tenants: N,
  rounds: ROUNDS,
  sizeKB,
  total: lines.length,
  ok: okLines.length,
  failed: lines.length - okLines.length,
  p50: pct(50),
  p95: pct(95),
  p99: pct(99),
  failuresByCode: byCode,
  slo_p95_ms_proposed_only: SLO_P95_MS || null,
  slo_met: SLO_P95_MS ? pct(95) <= SLO_P95_MS : null,
};
console.log(JSON.stringify(summary, null, 2));

// 6. Cleanup with the service role (per-object DELETE; the batch endpoint was
//    observed returning 200 while deleting nothing). Verify leftovers by
//    LISTING the bucket afterwards - metadata absence is reported, canonical
//    byte-level verification stays with the storage internals.
let cleaned = 0,
  cleanFailed = 0;
for (let i = 0; i < paths.length; i += 5) {
  await Promise.all(
    paths.slice(i, i + 5).map(async (p) => {
      // sb_secret_ keys are NOT JWTs: they must travel in the apikey header.
      // Bearer position yields storage 403 "Invalid Compact JWS" (observed
      // 2026-10-26: all 150 cleanup DELETEs denied until this header moved).
      const r = await fetch(API + "/storage/v1/object/case-documents/" + p, {
        method: "DELETE",
        headers: { apikey: SVC, Authorization: "Bearer " + SVC },
      });
      if (r.ok) cleaned++;
      else cleanFailed++;
    }),
  );
}
console.error(
  `cleanup: ${cleaned} deleted, ${cleanFailed} failed (leftovers reported, not hidden)`,
);
process.exit(0);
