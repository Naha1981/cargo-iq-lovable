#!/usr/bin/env node
// Free-tier-safe API latency baseline. Read-only GETs, no AI calls, no writes.
//
// Usage:
//   API=https://<ref>.supabase.co ANON=sb_publishable_... TOKEN=<jwt> \
//   node scripts/load-baseline.mjs [concurrency] [requestsPerWorker] [path]
//
// Defaults: concurrency 5, 40 requests per worker, /rest/v1/cases?select=id
// Keep totals modest on the free Nano tier: 5x40 = 200 requests.
const API = process.env.API;
const ANON = process.env.ANON;
const TOKEN = process.env.TOKEN;
if (!API || !ANON || !TOKEN) {
  console.error("API, ANON and TOKEN env vars are required");
  process.exit(2);
}
const concurrency = Number(process.argv[2] ?? 5);
const perWorker = Number(process.argv[3] ?? 40);
const path = process.argv[4] ?? "/rest/v1/cases?select=id";

const headers = { apikey: ANON, Authorization: `Bearer ${TOKEN}` };
const latencies = [];
let errors = 0;

async function worker() {
  for (let i = 0; i < perWorker; i++) {
    const start = performance.now();
    try {
      const res = await fetch(API + path, { headers, signal: AbortSignal.timeout(30000) });
      await res.arrayBuffer();
      if (!res.ok) errors++;
      else latencies.push(performance.now() - start);
    } catch {
      errors++;
    }
  }
}

const wallStart = performance.now();
await Promise.all(Array.from({ length: concurrency }, worker));
const wallMs = performance.now() - wallStart;

latencies.sort((a, b) => a - b);
const pct = (p) =>
  latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))];
const result = {
  concurrency,
  perWorker,
  ok: latencies.length,
  errors,
  wallMs: Math.round(wallMs),
  throughputRps: Math.round((latencies.length / wallMs) * 10000) / 10,
  p50ms: Math.round(pct(50)),
  p95ms: Math.round(pct(95)),
  p99ms: Math.round(pct(99)),
  maxMs: Math.round(latencies[latencies.length - 1] ?? 0),
};
console.log(JSON.stringify(result));
if (errors > 0) process.exit(1);
