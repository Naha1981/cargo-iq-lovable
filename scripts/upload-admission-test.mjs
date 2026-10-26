// PGlite test for 20261025220000_upload_admission.sql (upload admission semaphore).
// Semantics proven here: per-workspace cap, global cap, owner override beats env
// default, workspace 0 = disabled, release frees a slot, TTL expiry frees a slot,
// unconfigured (NULL/0 controls) = explicitly unbounded, non-member FORBIDDEN,
// lease release ownership. Concurrent same-slot contention is excluded by design:
// one advisory lock serializes check-and-insert inside each transaction.
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
create table public.tenants(id uuid primary key, name text);
create table public.user_roles(user_id uuid, tenant_id uuid, role text);
create table public.platform_admins(user_id uuid primary key, email text, created_at timestamptz default now());
create function public.is_tenant_member(t uuid) returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from public.user_roles where tenant_id = t and user_id = auth.uid()) $$;
create function public.is_platform_admin() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from public.platform_admins where user_id = auth.uid()) $$;
insert into public.tenants values ('11111111-1111-1111-1111-111111111111','Alpha'), ('22222222-2222-2222-2222-222222222222','Beta');
`);
await db.exec(
  readFileSync(
    new URL("../supabase/migrations/20261025220000_upload_admission.sql", import.meta.url),
    "utf8",
  ),
);
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const USER = "c0000000-0000-0000-0000-0000000000c1";
const USER_B = "c0000000-0000-0000-0000-0000000000c2";
const OUTSIDER = "d0000000-0000-0000-0000-0000000000d1";
const OWNER = "a0000000-0000-0000-0000-0000000000a1";
await db.query(`insert into public.user_roles values ($1,$2,'admin'),($3,$4,'admin')`, [
  USER,
  A,
  USER_B,
  B,
]);
await db.query(
  `insert into public.platform_admins(user_id,email) values ($1,'owner@example.com')`,
  [OWNER],
);
const asUser = (uid) => db.query(`select set_config('app.test_uid', $1, false)`, [uid]);
const acquire = async (t, tmax, gmax, ttl = 300) =>
  (await db.query(`select public.acquire_upload_slot($1,$2,$3,$4) as id`, [t, tmax, gmax, ttl]))
    .rows[0].id;

try {
  await asUser(USER);
  const l1 = await acquire(A, 2, null);
  const l2 = await acquire(A, 2, null);
  const l3 = await acquire(A, 2, null);
  if (!l1 || !l2) throw new Error("expected two leases");
  if (l3 !== null) throw new Error("third acquire should be refused at cap 2");
  ok("per-workspace cap: leases up to the cap, refused beyond it");
  await db.query(`select public.release_upload_slot($1)`, [l1]);
  const l4 = await acquire(A, 2, null);
  if (!l4) throw new Error("release should free a slot");
  ok("release frees a slot");
} catch (e) {
  bad("per-workspace cap and release", e);
}
try {
  await db.query(`delete from public.upload_leases`);
  await asUser(USER);
  const g1 = await acquire(A, null, 3);
  await asUser(USER_B);
  const g2 = await acquire(B, null, 3);
  const g3 = await acquire(B, null, 3);
  const g4 = await acquire(B, null, 3);
  if (!g1 || !g2 || !g3 || g4 !== null)
    throw new Error("global cap 3 not enforced: " + JSON.stringify([g1, g2, g3, g4]));
  ok("global cap counts leases across all workspaces");
} catch (e) {
  bad("global cap", e);
}
try {
  await db.query(`delete from public.upload_leases`);
  await asUser(OWNER);
  await db.query(`select public.admin_set_tenant_upload_concurrency($1, 5)`, [A]);
  await asUser(USER);
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push(await acquire(A, 2, null));
  if (ids.some((x) => !x)) throw new Error("override 5 should beat env default 2");
  ok("owner override wins over the app-supplied default");
  await asUser(OWNER);
  await db.query(`select public.admin_set_tenant_upload_concurrency($1, 0)`, [B]);
  await asUser(USER_B);
  if ((await acquire(B, 10, null)) !== null) throw new Error("workspace 0 must disable uploads");
  ok("explicit workspace 0 disables uploads for that workspace");
  await asUser(OWNER);
  await db.query(`select public.admin_set_tenant_upload_concurrency($1, NULL)`, [B]);
} catch (e) {
  bad("owner override", e);
}
try {
  await db.query(`delete from public.upload_leases`);
  await asUser(USER);
  const ids = [];
  for (let i = 0; i < 4; i++) ids.push(await acquire(A, null, null));
  if (ids.some((x) => !x)) throw new Error("unconfigured gate must be explicitly unbounded");
  ok("unconfigured (NULL controls) is explicitly unbounded, not silently capped");
} catch (e) {
  bad("unconfigured state", e);
}
try {
  await db.query(`delete from public.upload_leases`);
  await asUser(USER);
  const old = await acquire(A, 1, null);
  await db.query(
    `update public.upload_leases set acquired_at = now() - interval '10 minutes' where id = $1`,
    [old],
  );
  const fresh = await acquire(A, 1, null, 300);
  if (!fresh) throw new Error("expired lease should not hold the slot");
  ok("TTL expiry frees a slot held by a crashed client");
} catch (e) {
  bad("TTL expiry", e);
}
try {
  await asUser(OUTSIDER);
  await acquire(A, 1, null);
  bad("non-member acquire", "succeeded");
} catch (e) {
  /FORBIDDEN/.test(String(e))
    ? ok("non-member acquire denied FORBIDDEN")
    : bad("non-member acquire", e);
}
try {
  await db.query(`delete from public.upload_leases`);
  await asUser(USER);
  const lease = await acquire(A, 1, null);
  if (!(await db.query(`select public.verify_upload_lease($1,$2,300) as v`, [lease, A])).rows[0].v)
    throw new Error("live lease must verify");
  await asUser(USER_B);
  try {
    await db.query(`select public.release_upload_slot($1)`, [lease]);
    throw new Error("cross-workspace release must be denied");
  } catch (e2) {
    if (!/FORBIDDEN/.test(String(e2))) throw e2;
  }
  await asUser(USER);
  await db.query(`select public.release_upload_slot($1)`, [lease]);
  if ((await db.query(`select count(*)::int as n from public.upload_leases`)).rows[0].n !== 0)
    throw new Error("owner release must delete the lease");
  ok("lease verify works; only the holding workspace can release");
} catch (e) {
  bad("lease verify and release ownership", e);
}
console.log(fail ? `FAIL (${fail} failing, ${pass} passing)` : `ALL ${pass} CHECKS PASS`);
process.exit(fail ? 1 : 0);
