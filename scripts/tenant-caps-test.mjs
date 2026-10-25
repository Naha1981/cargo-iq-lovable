// PGlite test for 20261025200000_tenant_free_cap_overrides.sql (owner-settable per-tenant caps).
// Two controls: GLOBAL default/off (app-supplied p_daily_cap) and PER-WORKSPACE setting
// (tenant_free_caps: NULL inherit / 0 off / 1..10000 limit). Global off must override every
// workspace row; an invalid global control fails closed and is never silently overruled.
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
insert into public.user_roles values ('a0000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','admin');
insert into public.platform_admins values ('a0000000-0000-0000-0000-0000000000a1','owner@example.com', now());
`);
await db.exec(
  readFileSync(
    new URL("../supabase/migrations/20261024221000_free_extraction_daily_cap.sql", import.meta.url),
    "utf8",
  ),
);
await db.exec(
  readFileSync(
    new URL("../supabase/migrations/20261025200000_tenant_free_cap_overrides.sql", import.meta.url),
    "utf8",
  ),
);
await db.query(`SET app.test_uid = 'a0000000-0000-0000-0000-0000000000a1'`);
const T = "11111111-1111-1111-1111-111111111111";
const res = (cap) =>
  db
    .query("select public.reserve_free_extraction_attempt($1, $2) as r", [T, cap])
    .then((r) => r.rows[0].r);
const reset = () => db.query("delete from public.free_extraction_attempts where tenant_id=$1", [T]);
const setCap = (v) => db.query("select public.admin_set_tenant_free_cap($1, $2) as r", [T, v]);

// 1. DEFAULT: no workspace row - global default applies (2 reserves, 3rd refused)
await reset();
await setCap(null);
(await res(2)) === "reserved" && (await res(2)) === "reserved" && (await res(2)) === "over_cap"
  ? ok("default: global 2 enforced with no workspace row")
  : bad("default", "sequence wrong");

// 2. OVERRIDE: workspace 5 wins over global default 2 (5 reserves, 6th refused)
await reset();
await setCap(5);
let seq = [await res(2), await res(2), await res(2), await res(2), await res(2), await res(2)];
seq.slice(0, 5).every((x) => x === "reserved") && seq[5] === "over_cap"
  ? ok("override: workspace 5 wins over global default 2")
  : bad("override", JSON.stringify(seq));

// 3. GLOBAL OFF wins over workspace override: global 0/NULL/negative + workspace 5 -> closed
for (const g of [0, -3, null]) {
  await reset();
  (await res(g)) === "no_cap_configured"
    ? ok("global " + g + " + workspace override 5 -> closed (global off overrides all tenant caps)")
    : bad("globaloff" + g, "not closed");
}

// 4. WORKSPACE OFF: owner sets 0 -> tenant_disabled, distinct from over_cap, nothing counted
await reset();
await setCap(0);
(await res(10)) === "tenant_disabled"
  ? ok("workspace 0 -> tenant_disabled with global 10")
  : bad("toff", await res(10));
let n = await db.query(
  "select count(*)::int as n from public.free_extraction_attempts where tenant_id=$1",
  [T],
);
n.rows[0].n === 0 ? ok("tenant_disabled consumes no attempts") : bad("toffcount", n.rows[0].n);
(await res(0)) === "no_cap_configured"
  ? ok("workspace 0 + global 0 -> global state reported (global checked first)")
  : bad("toffg0", "wrong");

// 5. CLEAR: NULL restores inherit; workspace off then cleared -> default enforced again
await reset();
await setCap(0);
await setCap(null);
(await res(1)) === "reserved" && (await res(1)) === "over_cap"
  ? ok("clear (NULL) after off restores global default")
  : bad("clear", "wrong");

// 6. WRITE BOUNDS: negative and 10001 rejected; 0, 1, 10000 accepted; unknown tenant rejected
let rej = 0;
for (const v of [-1, 10001]) {
  try {
    await setCap(v);
  } catch (e) {
    if (/INVALID_CAP/.test(String(e))) rej++;
  }
}
try {
  await db.query(
    "select public.admin_set_tenant_free_cap('33333333-3333-3333-3333-333333333333', 5)",
  );
} catch (e) {
  if (/UNKNOWN_TENANT/.test(String(e))) rej++;
}
rej === 3 ? ok("negative/10001/unknown-tenant rejected") : bad("bounds", rej);
let acc = 0;
for (const v of [0, 1, 10000]) {
  try {
    await setCap(v);
    acc++;
  } catch {}
}
acc === 3 ? ok("0 (off), 1 and 10000 accepted") : bad("accepts", acc);

// 7. DENIED WRITES: non-owner cannot set or list (same opaque FORBIDDEN as other admin fns)
await db.query(`SET app.test_uid = 'b0000000-0000-0000-0000-0000000000b2'`);
let denied = false;
try {
  await setCap(5);
} catch (e) {
  denied = /FORBIDDEN/.test(String(e));
}
denied ? ok("non-owner set denied") : bad("nonowner set", "not denied");
denied = false;
try {
  await db.query("select public.admin_list_tenant_free_caps()");
} catch (e) {
  denied = /FORBIDDEN/.test(String(e));
}
denied ? ok("non-owner list denied") : bad("nonowner list", "not denied");
await db.query(`SET app.test_uid = 'a0000000-0000-0000-0000-0000000000a1'`);

// 8. OWNER LIST: override, attempts today, all workspaces, total
await reset();
await setCap(7);
await res(10);
await res(10);
const r = await db.query("select public.admin_list_tenant_free_caps() as r");
const rows = r.rows[0].r.rows;
const alpha = rows.find((x) => x.tenant_id === T);
alpha &&
alpha.override === 7 &&
alpha.attempts_today === 2 &&
rows.length === 2 &&
r.rows[0].r.total === 2
  ? ok("owner list: override 7, attempts_today 2, 2 workspaces, total 2")
  : bad("list", JSON.stringify(r.rows[0].r));

// 9. RLS + GRANTS: no direct table access; anon EXECUTE denied on both functions
await db.query("set role authenticated");
denied = false;
try {
  await db.query("select * from public.tenant_free_caps");
} catch (e) {
  denied = /permission denied|row-level security/i.test(String(e));
}
denied
  ? ok("authenticated direct SELECT on tenant_free_caps denied")
  : bad("rls caps", "not denied");
await db.query("reset role");
await db.query("set role anon");
denied = false;
try {
  await setCap(5);
} catch (e) {
  denied = /permission denied/i.test(String(e));
}
denied ? ok("anon set EXECUTE denied") : bad("anon set", "not denied");
denied = false;
try {
  await db.query("select public.admin_list_tenant_free_caps()");
} catch (e) {
  denied = /permission denied/i.test(String(e));
}
denied ? ok("anon list EXECUTE denied") : bad("anon list", "not denied");
await db.query("reset role");

console.log(fail === 0 ? `ALL ${pass} PASSED` : `${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
