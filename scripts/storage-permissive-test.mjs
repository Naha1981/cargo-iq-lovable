// PGlite test for 20261025250000_storage_permissive_policies.sql.
// Proves, with RLS enforced under SET ROLE authenticated:
//   1. a tenant member can upload + read case-documents under their own
//      tenant prefix (the versioned live policies);
//   2. a tenant member can READ cctv-evidence under their own prefix (the fix
//      for the deterministic 42501);
//   3. a tenant member canNOT INSERT/UPDATE/DELETE cctv-evidence (fail-closed
//      - writes are the service-role ingest path only);
//   4. cross-tenant and anon access stay denied in both buckets.
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
create type public.app_role as enum ('admin','investigator','viewer');
create table public.user_roles(user_id uuid, tenant_id uuid, role public.app_role);
create function public.is_tenant_member(t uuid) returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from public.user_roles where tenant_id = t and user_id = auth.uid()) $$;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean);
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
create function storage.foldername(n text) returns text[] language sql immutable as
$$ select (string_to_array(n, '/'))[1:array_length(string_to_array(n, '/'), 1) - 1] $$;
insert into storage.buckets values ('case-documents','case-documents',false), ('cctv-evidence','cctv-evidence',false);
alter table storage.objects enable row level security;
insert into public.user_roles values
  ('a0000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','investigator'),
  ('b0000000-0000-0000-0000-0000000000b2','22222222-2222-2222-2222-222222222222','viewer');
grant select, insert, update, delete on storage.objects to authenticated, anon;
grant usage on schema storage to authenticated, anon;
grant execute on function storage.foldername(text) to authenticated, anon;
grant execute on function public.is_tenant_member(uuid) to authenticated, anon;
`);

await db.exec(
  readFileSync(
    new URL(
      "../supabase/migrations/20261025250000_storage_permissive_policies.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);

const asUser = async (uid, fn) => {
  await db.query(`select set_config('app.test_uid', $1, false)`, [uid]);
  await db.exec(`set role authenticated`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('app.test_uid', '', false)`);
  }
};
const A = "a0000000-0000-0000-0000-0000000000a1"; // tenant 1111 investigator
const B = "b0000000-0000-0000-0000-0000000000b2"; // tenant 2222 viewer
const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";
const denied = (e) => String(e).includes("row-level security") || String(e).includes("42501");

// Seed one object per bucket per tenant as the superuser (service path).
await db.query(
  `insert into storage.objects(bucket_id, name) values
   ('case-documents', $1), ('case-documents', $2), ('cctv-evidence', $3), ('cctv-evidence', $4)`,
  [
    T1 + "/case-1/doc.pdf",
    T2 + "/case-9/doc.pdf",
    T1 + "/src/cam/obs/frame.jpg",
    T2 + "/src/cam/obs/frame.jpg",
  ],
);

// 1. Tenant A member uploads + reads own case docs.
const r1 = await asUser(A, async () => {
  await db.query(`insert into storage.objects(bucket_id, name) values ('case-documents', $1)`, [
    T1 + "/case-2/new.pdf",
  ]);
  const got = await db.query(`select name from storage.objects where bucket_id = 'case-documents'`);
  return got.rows.map((x) => x.name).sort();
});
if (r1.length === 2 && r1[1].endsWith("new.pdf")) ok("member uploads + reads own case documents");
else bad("member case docs", JSON.stringify(r1));

// 2. Tenant A member reads own cctv evidence (the fixed path).
const r2 = await asUser(A, async () => {
  const got = await db.query(`select name from storage.objects where bucket_id = 'cctv-evidence'`);
  return got.rows.map((x) => x.name);
});
if (r2.length === 1 && r2[0].startsWith(T1))
  ok("member reads own cctv evidence (deterministic 42501 fixed)");
else bad("member cctv read", JSON.stringify(r2));

// 3. Tenant A canNOT write cctv evidence (insert/update/delete all fail-closed).
const r3 = await asUser(A, async () => {
  const out = { insert: false, update: false, delete: false };
  try {
    await db.query(`insert into storage.objects(bucket_id, name) values ('cctv-evidence', $1)`, [
      T1 + "/x/y/z/f.jpg",
    ]);
  } catch (e) {
    out.insert = denied(e);
  }
  try {
    const upd = await db.query(
      `update storage.objects set name = name where bucket_id = 'cctv-evidence'`,
    );
    out.update = upd.affectedRows === 0; // no visible rows = denied
  } catch (e) {
    out.update = denied(e);
  }
  const del = await db.query(`delete from storage.objects where bucket_id = 'cctv-evidence'`);
  out.delete = del.affectedRows === 0; // no visible rows to delete = denied
  return out;
});
if (r3.insert && r3.update && r3.delete)
  ok("no tenant INSERT/UPDATE/DELETE on cctv-evidence (fail-closed)");
else bad("cctv fail-closed", JSON.stringify(r3));

// 4. Cross-tenant: B (tenant 2222 viewer) sees only own rows in both buckets,
//    and cannot upload into tenant 1111's prefix.
const r4 = await asUser(B, async () => {
  const cd = await db.query(`select name from storage.objects where bucket_id = 'case-documents'`);
  const cctv = await db.query(`select name from storage.objects where bucket_id = 'cctv-evidence'`);
  let uploadDenied = false;
  try {
    await db.query(`insert into storage.objects(bucket_id, name) values ('case-documents', $1)`, [
      T1 + "/case-3/evil.pdf",
    ]);
  } catch (e) {
    uploadDenied = denied(e);
  }
  return {
    cd: cd.rows.map((x) => x.name),
    cctv: cctv.rows.map((x) => x.name),
    uploadDenied,
  };
});
if (
  r4.cd.length === 1 &&
  r4.cd[0].startsWith(T2) &&
  r4.cctv.length === 1 &&
  r4.cctv[0].startsWith(T2) &&
  r4.uploadDenied
)
  ok("cross-tenant reads scoped to own prefix; cross-tenant upload denied");
else bad("cross-tenant", JSON.stringify(r4));

// 5. anon sees nothing.
await db.exec(`set role anon`);
const r5 = await db.query(`select count(*)::int as n from storage.objects`);
await db.exec(`reset role`);
if (r5.rows[0].n === 0) ok("anon sees no storage objects");
else bad("anon", JSON.stringify(r5.rows[0]));

console.log(`storage-permissive: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
