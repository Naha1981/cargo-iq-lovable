// PGlite test for 20261024219000_platform_admin.sql: owner-only, paged cross-tenant reads.
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
create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('app.test_jwt', true),'')::jsonb $$;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create table public.tenants(id uuid primary key, name text, created_at timestamptz default now());
create table public.user_roles(user_id uuid, tenant_id uuid, role text, created_at timestamptz default now());
create table public.cases(id uuid primary key, tenant_id uuid, title text, created_at timestamptz default now());
create table public.documents(id uuid primary key default gen_random_uuid(), tenant_id uuid, name text);
create table public.extracted_claims(id uuid primary key default gen_random_uuid(), document_id uuid, claim_text text);
create table public.contradictions(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, claim_a_id uuid, claim_b_id uuid, status text, created_at timestamptz default now());
insert into auth.users values ('a0000000-0000-0000-0000-0000000000a1','thabiso@example.com','{"full_name":"Thabiso Naha"}'),('b0000000-0000-0000-0000-0000000000b1','investigator@example.com','{}');
insert into public.tenants(id,name,created_at) values
 ('11111111-1111-1111-1111-111111111111','TenantA','2026-10-01'),('22222222-2222-2222-2222-222222222222','TenantB','2026-10-02'),('33333333-3333-3333-3333-333333333333','TenantC','2026-10-03');
insert into public.user_roles values
 ('a0000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','admin','2026-10-01'),
 ('b0000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','investigator','2026-10-02');
insert into public.cases values
 ('c1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','CaseA','2026-10-10'),
 ('c2222222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222222','CaseB','2026-10-11');
insert into public.documents(tenant_id,name) values ('11111111-1111-1111-1111-111111111111','MSC tariff v2026-09.pdf'),('11111111-1111-1111-1111-111111111111','Invoice INV-77.pdf');
insert into public.extracted_claims(document_id,claim_text)
 select id, 'Free time is 7 calendar days' from public.documents where name='MSC tariff v2026-09.pdf';
insert into public.extracted_claims(document_id,claim_text)
 select id, 'Free time is 5 working days' from public.documents where name='Invoice INV-77.pdf';
insert into public.contradictions(tenant_id,case_id,claim_a_id,claim_b_id,status)
 select '11111111-1111-1111-1111-111111111111','c1111111-1111-1111-1111-111111111111',a.id,b.id,'FLAGGED'
 from (select id from public.extracted_claims where claim_text like '%7 calendar%' limit 1) a,
      (select id from public.extracted_claims where claim_text like '%5 working%' limit 1) b;
insert into public.contradictions(tenant_id,case_id,status) values ('22222222-2222-2222-2222-222222222222','c2222222-2222-2222-2222-222222222222','RESOLVED');
`);
await db.exec(
  readFileSync(
    new URL("../supabase/migrations/20261024219000_platform_admin.sql", import.meta.url),
    "utf8",
  ),
);

await db.exec(
  `SET app.test_uid = 'a0000000-0000-0000-0000-0000000000a1'; SET app.test_jwt = '{"email":"thabiso@example.com"}'`,
);
try {
  await db.query("select public.admin_list_tenants()");
  bad("empty allowlist forbids", "succeeded");
} catch (e) {
  String(e.message).includes("FORBIDDEN")
    ? ok("empty allowlist forbids everyone")
    : bad("empty allowlist", e.message);
}
const rls = await db.query(
  `select c.relrowsecurity as on, (select count(*) from pg_policy where polrelid='public.platform_admins'::regclass) as pols from pg_class c where c.relname='platform_admins'`,
);
rls.rows[0].on === true && rls.rows[0].pols == 0
  ? ok("platform_admins: RLS on, zero policies")
  : bad("platform_admins RLS", JSON.stringify(rls.rows));

await db.query("RESET app.test_uid");
await db.query(
  "insert into public.platform_admins(user_id, email) values ('a0000000-0000-0000-0000-0000000000a1', 'owner-record@example.com')",
);
await db.exec(
  `SET app.test_uid = 'a0000000-0000-0000-0000-0000000000a1'; SET app.test_jwt = '{"email":"anything@example.com"}'`,
);

// Tenants: page shape + full reachability via cursor (3 tenants, page size 1)
let t = await db.query("select public.admin_list_tenants() as r");
t.rows[0].r.total == 3 && t.rows[0].r.rows.length === 3 && t.rows[0].r.next_cursor === null
  ? ok("tenants: full page under limit, total=3, no cursor")
  : bad("tenants", JSON.stringify(t.rows));
let p1 = await db.query("select public.admin_list_tenants(1) as r");
p1.rows[0].r.rows.length === 1 && p1.rows[0].r.total == 3 && p1.rows[0].r.next_cursor
  ? ok("tenants: bounded page 1 of 3 with next_cursor")
  : bad("tenants p1", JSON.stringify(p1.rows));
let seen = new Set(p1.rows[0].r.rows.map((x) => x.id));
let cursor = p1.rows[0].r.next_cursor;
let guard = 0;
while (cursor && guard++ < 10) {
  const pg = await db.query("select public.admin_list_tenants(1, $1) as r", [cursor]);
  pg.rows[0].r.rows.forEach((x) => seen.add(x.id));
  cursor = pg.rows[0].r.next_cursor;
}
seen.size === 3 && !cursor
  ? ok("tenants: cursor walk reaches every row exactly, ends null")
  : bad("tenant walk", [...seen].join(","));

// Users: identity + shape
const u = await db.query("select public.admin_list_users() as r");
u.rows[0].r.rows.length === 2 &&
u.rows[0].r.total == 2 &&
u.rows[0].r.rows.some((x) => x.display === "Thabiso Naha" && x.email === "thabiso@example.com") &&
u.rows[0].r.rows.some((x) => x.display === "investigator@example.com")
  ? ok("users: display name or email fallback, total=2")
  : bad("users", JSON.stringify(u.rows));

// Cases: counts + shape
const c = await db.query("select public.admin_list_cases() as r");
c.rows[0].r.rows.length === 2 &&
c.rows[0].r.total == 2 &&
c.rows[0].r.rows.find((x) => x.title === "CaseA").open_disputes === 1
  ? ok("cases: open-dispute counts, total=2")
  : bad("cases", JSON.stringify(c.rows));

// Disputes: case title + claim summary + SOURCE DOCUMENTS
const d = await db.query("select public.admin_list_disputes() as r");
const row = d.rows[0].r.rows[0];
d.rows[0].r.total == 1 &&
row.case_title === "CaseA" &&
row.summary.includes("7 calendar days") &&
row.summary.includes("5 working days") &&
row.source_documents.length === 2 &&
row.source_documents.includes("MSC tariff v2026-09.pdf") &&
row.source_documents.includes("Invoice INV-77.pdf")
  ? ok("disputes: case title + summary + both source documents")
  : bad("disputes", JSON.stringify(d.rows));

// Drilldown: full claims + per-claim source document
const dg = await db.query("select public.admin_get_dispute($1) as r", [row.id]);
dg.rows[0].r.claim_a.includes("7 calendar") &&
dg.rows[0].r.claim_b.includes("5 working") &&
dg.rows[0].r.claim_a_document.name === "MSC tariff v2026-09.pdf" &&
dg.rows[0].r.claim_b_document.name === "Invoice INV-77.pdf"
  ? ok("drilldown: full claims + per-claim source documents")
  : bad("drilldown", JSON.stringify(dg.rows));

// Non-owner: everything forbidden, even with the seeded email but wrong user id
await db.exec(
  `SET app.test_uid = 'b0000000-0000-0000-0000-0000000000b1'; SET app.test_jwt = '{"email":"owner-record@example.com"}'`,
);
for (const fn of [
  "admin_list_tenants",
  "admin_list_users",
  "admin_list_cases",
  "admin_list_disputes",
]) {
  try {
    await db.query(`select public.${fn}()`);
    bad("non-owner " + fn, "succeeded");
  } catch (e) {
    String(e.message).includes("FORBIDDEN")
      ? ok("non-owner forbidden: " + fn)
      : bad("non-owner " + fn, e.message);
  }
}
try {
  await db.query("select public.admin_get_dispute($1)", [row.id]);
  bad("non-owner drilldown", "succeeded");
} catch (e) {
  String(e.message).includes("FORBIDDEN")
    ? ok("non-owner forbidden: admin_get_dispute")
    : bad("non-owner drilldown", e.message);
}

// No session: forbidden
await db.exec("RESET app.test_uid; RESET app.test_jwt");
try {
  await db.query("select public.admin_list_tenants()");
  bad("no-session", "succeeded");
} catch (e) {
  ok("no session forbidden");
}

// Revocation: delete row -> immediately forbidden
await db.query("RESET app.test_uid");
await db.query(
  "delete from public.platform_admins where user_id = 'a0000000-0000-0000-0000-0000000000a1'",
);
await db.exec(`SET app.test_uid = 'a0000000-0000-0000-0000-0000000000a1'`);
try {
  await db.query("select public.admin_list_tenants()");
  bad("revoked owner", "succeeded");
} catch (e) {
  String(e.message).includes("FORBIDDEN")
    ? ok("revoked owner forbidden immediately")
    : bad("revoked", e.message);
}

// RLS execution proof: non-owner role reads zero allowlist rows
await db.query("RESET app.test_uid");
await db.query(
  "insert into public.platform_admins(user_id) values ('a0000000-0000-0000-0000-0000000000a1')",
);
let rlsExec = "unknown";
try {
  await db.query("SET ROLE authenticated");
  const r = await db.query("select count(*)::int as n from public.platform_admins");
  rlsExec = r.rows[0].n === 0 ? "denied" : "LEAKED " + r.rows[0].n;
} catch (e) {
  rlsExec = "denied";
} finally {
  await db.query("RESET ROLE").catch(() => {});
}
rlsExec === "denied"
  ? ok("RLS execution: authenticated role reads zero allowlist rows")
  : bad("RLS execution", rlsExec);

// Grants inspection: EXECUTE privileges on every admin RPC + no direct table access
const fns = [
  "is_platform_admin()",
  "admin_list_tenants(integer,timestamptz)",
  "admin_list_users(integer,timestamptz)",
  "admin_list_cases(integer,timestamptz)",
  "admin_list_disputes(integer,timestamptz)",
  "admin_get_dispute(uuid)",
];
for (const fn of fns) {
  const a = await db.query(`select has_function_privilege('anon','public.${fn}','EXECUTE') as p`);
  const u = await db.query(
    `select has_function_privilege('authenticated','public.${fn}','EXECUTE') as p`,
  );
  a.rows[0].p === false && u.rows[0].p === true
    ? ok(`grants ${fn}: anon denied, authenticated granted`)
    : bad(`grants ${fn}`, `anon=${a.rows[0].p} auth=${u.rows[0].p}`);
}
const tp = await db.query(
  `select has_table_privilege('authenticated','public.platform_admins','SELECT') as p, has_table_privilege('anon','public.platform_admins','SELECT') as q`,
);
tp.rows[0].p === false && tp.rows[0].q === false
  ? ok("platform_admins: no direct table SELECT for authenticated/anon")
  : bad("platform_admins table grant", JSON.stringify(tp.rows));

console.log(fail === 0 ? `ALL ${pass} PASSED` : `${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
