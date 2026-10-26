// Local correctness test for scripts/load-50-tenants.mjs - no staging, no AI, no network
// beyond localhost. Stands up a stub Supabase API and a stub psql, then runs the real
// harness against them and asserts: per-tenant own-prefix path discipline, concurrent
// rounds, per-tenant JWT use, error classification (injected 403 + 500), percentile
// summary, proposed-only SLO scoring, and cleanup accounting.
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const N = 5,
  ROUNDS = 2;
const tenantUuid = (i) => `00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`;
const uploads = [];
const authedTenants = new Set();

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.endsWith("/auth/v1/token")) {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      const i = Number(JSON.parse(b).email.match(/synth-cap-(\d+)/)[1]);
      authedTenants.add(i);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ access_token: "jwt-" + i, user: { id: "user-" + i } }));
    });
    return;
  }
  if (url.pathname.includes("/storage/v1/object/case-documents/")) {
    const p = decodeURIComponent(url.pathname.split("/case-documents/")[1]);
    if (req.method === "POST") {
      const tenant = p.split("/")[0];
      const jwt = (req.headers.authorization ?? "").replace("Bearer ", "");
      let status = 200,
        body = { Key: p };
      if (jwt === "jwt-3") {
        status = 403;
        body = { code: "42501", message: "row-level security" };
      }
      if (jwt === "jwt-4") {
        status = 500;
        body = { error: "Internal", message: "boom" };
      }
      uploads.push({ p, tenant, jwt, status });
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }
    if (req.method === "DELETE") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("[]");
      return;
    }
  }
  res.writeHead(404);
  res.end("{}");
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

// Stub psql: answers the two queries the harness makes.
const bin = path.join(os.tmpdir(), "cq-mock-bin-" + process.pid);
mkdirSync(bin, { recursive: true });
writeFileSync(
  path.join(bin, "psql"),
  `#!/usr/bin/env node
const q = process.argv[process.argv.length - 1];
if (q.includes("count(*)")) { console.log("${N}"); }
else { const m = q.match(/user_id = 'user-(\\d+)'/); console.log("${tenantUuid(1).slice(0, -2)}" + m[1].padStart(2, "0")); }
`,
);
spawnSync("chmod", ["+x", path.join(bin, "psql")]);

const env = {
  ...process.env,
  PATH: bin + ":" + process.env.PATH,
  API: `http://127.0.0.1:${port}/khuddkzdghdvdhroeoag`,
  ANON: "mock-anon",
  SVC: "mock-svc",
  PGHOST: "mock",
  PGUSER: "mock",
  PGPASSWORD: "mock",
  PGDATABASE: "postgres",
  SLO_P95_MS: "2000",
};
const runHarness = (args, env) =>
  new Promise((resolve) => {
    const p = spawn("node", ["scripts/load-50-tenants.mjs", ...args], { env });
    let stdout = "",
      stderr = "";
    p.stdout.on("data", (c) => (stdout += c));
    p.stderr.on("data", (c) => (stderr += c));
    p.on("close", (status) => resolve({ status, stdout, stderr }));
  });

const run = await runHarness([String(N), String(ROUNDS), "1"], env);

const failures = [];
const check = (name, cond, detail) => {
  if (!cond) failures.push(name + (detail ? ": " + detail : ""));
};

check("harness exit 0", run.status === 0, (run.stderr || "").slice(-300));
const summary = JSON.parse(run.stdout);
check("total = N*ROUNDS", summary.total === N * ROUNDS, JSON.stringify(summary));
check(
  "3 tenants ok, 2 classified failed",
  summary.ok === 3 * ROUNDS && summary.failed === 2 * ROUNDS,
  JSON.stringify(summary),
);
check(
  "403|42501 classified",
  summary.failuresByCode["403|42501"] === ROUNDS,
  JSON.stringify(summary.failuresByCode),
);
check(
  "500|Internal classified",
  summary.failuresByCode["500|Internal"] === ROUNDS,
  JSON.stringify(summary.failuresByCode),
);
check(
  "p50/p95/p99 present",
  [summary.p50, summary.p95, summary.p99].every((v) => typeof v === "number"),
);
check(
  "SLO proposed-only + scored",
  summary.slo_p95_ms_proposed_only === 2000 && typeof summary.slo_met === "boolean",
);
check("every tenant signed in", authedTenants.size === N, [...authedTenants].join(","));
const okUploads = uploads.filter((u) => u.status === 200);
check(
  "own-prefix path discipline",
  okUploads.every((u) => u.p === u.tenant + "/cap50-" + u.p.split("/cap50-")[1]),
);
check(
  "tenant uuid matches its jwt",
  okUploads.every((u) => u.tenant === tenantUuid(Number(u.jwt.replace("jwt-", "")))),
);
check(
  "every successful upload cleaned (DELETE 200)",
  run.stderr.includes(`cleanup: ${3 * ROUNDS} deleted, 0 failed`),
  run.stderr.slice(-200),
);

// Staging guard: a non-staging API must be refused even against the mock.
const env2 = { ...env, API: `http://127.0.0.1:${port}/not-the-staging-ref` };
const run2 = await runHarness(["1", "1", "1"], env2);
check(
  "non-staging API refused",
  run2.status === 2 && run2.stderr.includes("REFUSING"),
  String(run2.status),
);
server.close();
rmSync(bin, { recursive: true, force: true });

if (failures.length) {
  console.error("FAIL: " + failures.join(" | "));
  process.exit(1);
}
console.log(
  `load-50-tenants mock: ${N} tenants x ${ROUNDS} rounds, path/JWT discipline, 403+500 classification, percentiles, SLO scoring, cleanup, staging guard - all correct`,
);
