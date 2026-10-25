#!/usr/bin/env node
// Reproducible storage-upload load probe for the CargoIQ staging project.
// Writes real file bytes to the case-documents bucket as a synthetic tenant,
// logs EVERY request as JSONL (timestamp, worker, latency, HTTP status, error
// code, body snippet), prints a summary with error classification, then cleans
// up its own objects with per-object Storage API DELETEs and reports leftovers.
//
// Usage:
//   API=https://<ref>.supabase.co ANON=sb_publishable_... \
//   BENCH_EMAIL=synth-a@cargoiq-staging.invalid BENCH_PASSWORD=... TENANT=<uuid> \
//   node scripts/load-upload.mjs [concurrency] [perWorker] [sizeKB] [staggerMs]
//
// Defaults: 5 workers x 10 uploads of 100KB, no stagger. Keep bursts short on
// the free Nano tier (60 DB connections / 200 pooler clients / 5 MB/s disk -
// supabase.com/docs/guides/platform/compute-and-disk). A fresh JWT is minted
// per run so token expiry cannot masquerade as a server failure.
const { API, ANON, BENCH_EMAIL, BENCH_PASSWORD, TENANT } = process.env;
for (const k of ["API", "ANON", "BENCH_EMAIL", "BENCH_PASSWORD", "TENANT"])
  if (!process.env[k]) {
    console.error(k + " is required");
    process.exit(2);
  }

const conc = Number(process.argv[2] ?? 5);
const per = Number(process.argv[3] ?? 10);
const sizeKB = Number(process.argv[4] ?? 100);
const staggerMs = Number(process.argv[5] ?? 0);

const authRes = await fetch(API + "/auth/v1/token?grant_type=password", {
  method: "POST",
  headers: { apikey: ANON, "content-type": "application/json" },
  body: JSON.stringify({ email: BENCH_EMAIL, password: BENCH_PASSWORD }),
});
const auth = await authRes.json();
if (!auth.access_token) {
  console.error("auth failed: " + JSON.stringify(auth));
  process.exit(2);
}
const TOKEN = auth.access_token;
const H = () => ({ apikey: ANON, Authorization: "Bearer " + TOKEN });

const body = new Uint8Array(sizeKB * 1024).map((_, i) => i % 251);
const lines = [];
const paths = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function one(w, i) {
  const p = TENANT + "/loadbench-" + Date.now() + "-" + w + "-" + i + ".bin";
  const t = performance.now();
  const rec = { ts: new Date().toISOString(), w, i };
  try {
    const r = await fetch(API + "/storage/v1/object/case-documents/" + p, {
      method: "POST",
      headers: { ...H(), "content-type": "application/octet-stream", "x-upsert": "true" },
      body,
      signal: AbortSignal.timeout(120000),
    });
    const text = await r.text();
    rec.ms = Math.round(performance.now() - t);
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
    rec.ms = Math.round(performance.now() - t);
    rec.ok = false;
    rec.code = "exception";
    rec.msg = String(e).slice(0, 120);
  }
  lines.push(rec);
}

await Promise.all(
  Array.from({ length: conc }, async (_, w) => {
    if (staggerMs) await sleep(w * staggerMs);
    for (let i = 0; i < per; i++) await one(w, i);
  }),
);

const ok = lines.filter((l) => l.ok);
const byCode = {};
for (const l of lines.filter((l) => !l.ok)) {
  const k = l.status + "|" + l.code;
  byCode[k] = (byCode[k] ?? 0) + 1;
}
const lat = ok.map((l) => l.ms).sort((a, b) => a - b);
const pct = (p) => lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))] ?? null;

// Cleanup: per-object Storage API DELETE (the batch endpoint was observed
// returning 200 while deleting nothing on this project, 25 Oct 2026).
let cleaned = 0,
  cleanFailed = 0;
for (let i = 0; i < paths.length; i += 5) {
  await Promise.all(
    paths.slice(i, i + 5).map(async (p) => {
      const r = await fetch(API + "/storage/v1/object/case-documents/" + p, {
        method: "DELETE",
        headers: H(),
      });
      if (r.ok) cleaned++;
      else cleanFailed++;
    }),
  );
}

console.log(
  JSON.stringify({
    conc,
    per,
    sizeKB,
    staggerMs,
    total: lines.length,
    ok: ok.length,
    failed: lines.length - ok.length,
    failuresByCode: byCode,
    p50: pct(50),
    p95: pct(95),
    max: lat[lat.length - 1] ?? null,
    cleanup: { deleted: cleaned, failed: cleanFailed },
  }),
);
for (const l of lines.filter((l) => !l.ok)) console.error("JSONL " + JSON.stringify(l));
if (cleanFailed > 0) console.error("WARNING: " + cleanFailed + " bench objects left in bucket");
