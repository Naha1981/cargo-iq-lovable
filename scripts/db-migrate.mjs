#!/usr/bin/env node
// CargoIQ versioned database migration runner.
//
// Applies the proven from-zero order ONCE, records every applied file with its
// SHA-256, refuses checksum drift (a changed already-applied file), and is safe
// to re-run: pending files only.
//
// Order (proven on a blank Supabase project, 25 Oct 2026):
//   1. drizzle/migrations/*.sql   (base schema: app_role, 12 core tables, RLS, base functions)
//   2. supabase/migrations/*.sql  (chronological by filename)
//
// Usage:
//   node scripts/db-migrate.mjs status     # applied vs pending vs drift
//   node scripts/db-migrate.mjs apply      # apply pending files (safe to re-run)
//   node scripts/db-migrate.mjs from-zero  # apply everything; fails unless DB has no user tables
//   node scripts/db-migrate.mjs adopt      # record all files as applied WITHOUT running them
//                                          # (only for databases already built by hand)
//
// Target: the default `postgres` database of a Supabase project (the platform
// schemas auth/storage and roles anon/authenticated/service_role already exist
// there; other databases on the same instance do NOT have them and are not
// supported). "from-zero" means zero USER tables in public, not a bare instance.
// Connection: standard libpq env (PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD
// PGSSLMODE). Requires psql on PATH matching the server major version.
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const LAYERS = ["drizzle/migrations", "supabase/migrations"];
const files = LAYERS.flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => ({ path: `${dir}/${f}`, name: `${dir}/${f}` })),
);
if (files.length === 0) throw new Error("no migration files found - run from the repo root");

const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const psql = (args, input) =>
  execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-t", "-A", ...args], {
    input,
    stdio: ["pipe", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  })
    .toString()
    .trim();

const cmd = process.argv[2];
if (!["status", "apply", "from-zero", "adopt"].includes(cmd)) {
  console.error("usage: node scripts/db-migrate.mjs status|apply|from-zero|adopt");
  process.exit(2);
}

psql(["-c", "select 1"]); // fail fast on bad connection
psql(["-c", "set client_min_messages=warning"]);
psql([
  "-c",
  "create table if not exists public.schema_migrations(filename text primary key, sha256 text not null, applied_at timestamptz not null default now()); " +
    // Internal runner ledger: never API-visible. Platform default privileges would
    // otherwise grant full read/write to anon/authenticated via PostgREST (verified
    // live on staging: anonymous API read + write surface). Owner is not subject to
    // RLS without FORCE, so the runner keeps working.
    "revoke all on table public.schema_migrations from anon, authenticated, service_role; " +
    "alter table public.schema_migrations enable row level security",
]);

const rows = psql([
  "-c",
  "select filename || '|' || sha256 from public.schema_migrations order by 1",
])
  .split("\n")
  .filter(Boolean)
  .map((r) => r.split("|"));
const applied = new Map(rows);

let drift = 0;
for (const [name, old] of applied) {
  const f = files.find((x) => x.name === name);
  if (!f) {
    console.log(
      `RECORDED-BUT-MISSING  ${name}  (applied to this DB but not in the repo - investigate)`,
    );
    drift++;
  } else if (sha(f.path) !== old) {
    console.log(
      `DRIFT  ${name}  (file changed after apply - migrations are append-only, fix forward)`,
    );
    drift++;
  }
}
const pending = files.filter((f) => !applied.has(f.name));

if (cmd === "status" || drift > 0) {
  console.log(`applied=${applied.size} pending=${pending.length} drift=${drift}`);
  for (const f of pending) console.log(`PENDING  ${f.name}`);
  if (drift > 0) process.exit(1);
  if (cmd === "status") process.exit(0);
}

if (cmd === "from-zero") {
  const n = Number(
    psql([
      "-c",
      "select count(*) from information_schema.tables where table_schema='public' and table_name <> 'schema_migrations'",
    ]),
  );
  if (n > 0) {
    console.error(
      `from-zero refused: database already has ${n} user tables. Use 'apply' or 'adopt'.`,
    );
    process.exit(1);
  }
}

const todo = cmd === "adopt" ? pending : pending;
for (const f of todo) {
  const digest = sha(f.path);
  if (cmd === "adopt") {
    psql([
      "-c",
      `insert into public.schema_migrations(filename, sha256) values ('${f.name}', '${digest}') on conflict do nothing`,
    ]);
    console.log(`ADOPTED  ${f.name}`);
    continue;
  }
  // one transaction per file; psql -1 rolls the file back on any error
  psql(["-1", "-f", f.path]);
  psql([
    "-c",
    `insert into public.schema_migrations(filename, sha256) values ('${f.name}', '${digest}')`,
  ]);
  console.log(`APPLIED  ${f.name}`);
}
console.log(
  `done: applied=${applied.size + todo.length - (cmd === "adopt" ? 0 : 0)} pending=0 drift=0`,
);
