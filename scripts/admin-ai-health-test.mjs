// PGlite test for 20261025210000_admin_ai_health.sql: owner-only aggregate AI
// health report (docs/AI-HEALTH-EMAIL.md). Counts and statuses only.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
let pass = 0,
  fail = 0;
const ok = (n) => {
  pass++;
  console.log("PASS", n);
};
const bad = (n, e) => {
  fail++;
  console.log("FAIL", n, "-", e);
};
const db = new PGlite();
await db.exec(`
create role authenticated nologin; create role anon nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_uid', true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('app.test_jwt_role', true),'')::jsonb $$;
create table public.tenants(id uuid primary key, name text, created_at timestamptz default now());
create table public.documents(id uuid primary key default gen_random_uuid(), tenant_id uuid, name text, extraction_status text not null default 'PENDING', uploaded_at timestamptz not null default now());
create table public.app_errors(id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(), route text, message text, stack text, source text, user_id uuid);
create table public.free_extraction_attempts(tenant_id uuid, day date, attempts integer not null default 0, primary key (tenant_id, day));
insert into public.tenants(id,name) values
 ('11111111-1111-1111-1111-111111111111','TenantA'),('22222222-2222-2222-2222-222222222222','TenantB');
insert into public.documents(tenant_id,name,extraction_status,uploaded_at) values
 ('11111111-1111-1111-1111-111111111111','a.pdf','EXTRACTED|REVIEW:MODEL_RAN',now()),
 ('11111111-1111-1111-1111-111111111111','b.pdf','EXTRACTED_INCOMPLETE|REVIEW:MODEL_FAILED|NOTE:timeout',now()),
 ('22222222-2222-2222-2222-222222222222','c.pdf','PENDING',now() - interval '2 days');
insert into public.app_errors(route,message,source) values
 ('/cases/x','boom','client'),('/cases/y','boom2','client'),('/admin','boom3','server');
insert into public.free_extraction_attempts values
 ('11111111-1111-1111-1111-111111111111',(now() at time zone 'utc')::date,4),
 ('22222222-2222-2222-2222-222222222222',(now() at time zone 'utc')::date,3);
`);
await db.exec(
  readFileSync(
    new URL("../supabase/migrations/20261024219000_platform_admin.sql", import.meta.url),
    "utf8",
  ),
);
await db.exec(
  readFileSync(
    new URL("../supabase/migrations/20261025210000_admin_ai_health.sql", import.meta.url),
    "utf8",
  ),
);
const OWNER = "a0000000-0000-0000-0000-0000000000a1";
const OTHER = "b0000000-0000-0000-0000-0000000000b1";
await db.query(
  `insert into public.platform_admins(user_id,email) values ($1,'owner@example.com')`,
  [OWNER],
);
const asUser = (uid) =>
  uid
    ? db.query(`select set_config('app.test_uid', $1, false)`, [uid])
    : db.query(`select set_config('app.test_uid', '', false)`);
const asServiceRole = async (role) => {
  await db.query(`select set_config('app.test_uid', '', false)`);
  await db.query(`select set_config('app.test_jwt_role', $1, false)`, [role]);
};

try {
  await asUser(OWNER);
  const { rows } = await db.query(`select public.admin_get_ai_health() as report`);
  const r = rows[0].report;
  if (r.documents_24h["EXTRACTED|REVIEW:MODEL_RAN"] !== 1)
    throw new Error("24h MODEL_RAN count wrong: " + JSON.stringify(r.documents_24h));
  if (r.documents_24h["EXTRACTED_INCOMPLETE|REVIEW:MODEL_FAILED|NOTE:timeout"] !== 1)
    throw new Error("24h MODEL_FAILED count wrong");
  if ((r.documents_7d["PENDING"] ?? 0) !== 1) throw new Error("7d PENDING count wrong");
  if (r.app_errors_24h_total !== 3)
    throw new Error("app error total wrong: " + r.app_errors_24h_total);
  if (
    r.app_errors_24h_top_sources[0].source !== "client" ||
    r.app_errors_24h_top_sources[0].n !== 2
  )
    throw new Error("top sources wrong: " + JSON.stringify(r.app_errors_24h_top_sources));
  if (r.free_attempts_today !== 7) throw new Error("free attempts wrong: " + r.free_attempts_today);
  if (!r.latest_document_at || !r.latest_app_error_at)
    throw new Error("liveness timestamps missing");
  ok("platform owner receives aggregate counts across all tenants");
} catch (e) {
  bad("platform owner report", e);
}
for (const [label, uid] of [
  ["non-owner authenticated", OTHER],
  ["unauthenticated", null],
]) {
  try {
    await asUser(uid);
    await db.query(`select public.admin_get_ai_health()`);
    bad(label + " denied", "call succeeded");
  } catch (e) {
    /FORBIDDEN/.test(String(e))
      ? ok(label + " denied with opaque FORBIDDEN")
      : bad(label + " denied", e);
  }
}
try {
  await db.query(`select public.is_platform_admin()`);
  await asUser(OTHER);
  const probe = await db.query(`select public.admin_get_ai_health()`).then(
    () => "visible",
    () => "denied",
  );
  if (probe !== "denied") throw new Error("aggregate leak: report visible to non-owner");
  const text = JSON.stringify(
    (await db.query(`select public.admin_get_ai_health()`).catch(() => ({}))) ?? {},
  );
  if (/a\.pdf|TenantA|boom/.test(text)) throw new Error("identifiers leaked into denial");
  ok("no aggregate or identifier leakage to non-owners");
} catch (e) {
  bad("aggregate privacy", e);
}
try {
  await asServiceRole('{"role":"service_role"}');
  const { rows } = await db.query(`select public.admin_get_ai_health() as report`);
  if (!rows[0].report || typeof rows[0].report.app_errors_24h_total !== "number")
    throw new Error("service_role report malformed");
  await asServiceRole('{"role":"authenticated"}');
  let denied = false;
  try {
    await db.query(`select public.admin_get_ai_health()`);
  } catch (e) {
    denied = /FORBIDDEN/.test(String(e));
  }
  if (!denied) throw new Error("non-service role without owner row must be denied");
  await db.query(`select set_config('app.test_jwt_role', '', false)`);
  ok("service role (cron invocation) allowed; ordinary roles still denied");
} catch (e) {
  bad("service role access", e);
}
console.log(fail ? `FAIL (${fail} failing, ${pass} passing)` : `ALL ${pass} CHECKS PASS`);
process.exit(fail ? 1 : 0);
