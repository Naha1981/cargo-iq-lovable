// Applies the migration runner's exact two-layer order (scripts/db-migrate.mjs:
// drizzle/migrations/*.sql then supabase/migrations/*.sql) to a fresh database,
// mirroring Supabase's built-in schemas/roles (auth, storage, anon,
// authenticated, service_role) with minimal shims, and fails on the first
// error. The supabase/migrations directory alone was never the complete set:
// the base schema lives in drizzle/migrations (runner layer 1).
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
const db = await PGlite.create();
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create table auth.users(id uuid primary key default gen_random_uuid());
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
create function storage.foldername(n text) returns text[] language sql immutable as
$$ select string_to_array(n, '/') $$;
`);
const layers = ["drizzle/migrations", "supabase/migrations"];
const files = layers.flatMap((dir) =>
  fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => path.join(dir, f)),
);
let ok = 0;
let first = null;
for (const f of files) {
  try {
    await db.exec(fs.readFileSync(f, "utf8"));
    ok++;
  } catch (e) {
    first = { f, err: String(e.message || e).slice(0, 400) };
    break;
  }
}
const counts = {};
if (!first) {
  counts.tables = (
    await db.query(
      `select count(*)::int as n from information_schema.tables where table_schema='public'`,
    )
  ).rows[0].n;
  counts.functions = (
    await db.query(
      `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`,
    )
  ).rows[0].n;
  counts.policies = (
    await db.query(`select count(*)::int as n from pg_policies where schemaname='public'`)
  ).rows[0].n;
}
console.log(
  JSON.stringify({ total: files.length, applied: ok, firstFailure: first, ...counts }, null, 1),
);
if (first) process.exit(1);
