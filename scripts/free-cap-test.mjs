// PGlite test for 20261024221000_free_extraction_daily_cap.sql (per-workspace daily free-attempt cap).
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
create function public.is_tenant_member(t uuid) returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from public.user_roles where tenant_id = t and user_id = auth.uid()) $$;
insert into public.tenants values ('11111111-1111-1111-1111-111111111111','A'), ('22222222-2222-2222-2222-222222222222','B');
insert into public.user_roles values ('a0000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','admin');
`);
await db.exec(
  readFileSync(
    new URL("../supabase/migrations/20261024221000_free_extraction_daily_cap.sql", import.meta.url),
    "utf8",
  ),
);
await db.query(`SET app.test_uid = 'a0000000-0000-0000-0000-0000000000a1'`);
const T = "11111111-1111-1111-1111-111111111111";

// 1. No cap configured (0, negative, NULL): fail closed, nothing written
let r = await db.query("select public.reserve_free_extraction_attempt($1, 0) as r", [T]);
r.rows[0].r === "no_cap_configured" ? ok("cap 0 -> no_cap_configured") : bad("cap0", r.rows[0].r);
r = await db.query("select public.reserve_free_extraction_attempt($1, -3) as r", [T]);
r.rows[0].r === "no_cap_configured"
  ? ok("negative cap -> no_cap_configured")
  : bad("capneg", r.rows[0].r);
r = await db.query("select public.reserve_free_extraction_attempt($1, NULL) as r", [T]);
r.rows[0].r === "no_cap_configured"
  ? ok("NULL cap -> no_cap_configured")
  : bad("capnull", r.rows[0].r);
let n = await db.query("select count(*)::int as n from public.free_extraction_attempts");
n.rows[0].n === 0 ? ok("no_cap writes nothing") : bad("no_cap row", n.rows[0].n);

// 2. Cap 2: two reservations accepted, third refused atomically; refused attempt writes nothing
r = await db.query("select public.reserve_free_extraction_attempt($1, 2) as r", [T]);
r.rows[0].r === "reserved" ? ok("attempt 1 reserved") : bad("a1", r.rows[0].r);
r = await db.query("select public.reserve_free_extraction_attempt($1, 2) as r", [T]);
r.rows[0].r === "reserved" ? ok("attempt 2 reserved") : bad("a2", r.rows[0].r);
r = await db.query("select public.reserve_free_extraction_attempt($1, 2) as r", [T]);
r.rows[0].r === "over_cap" ? ok("attempt 3 over_cap (cap holds)") : bad("a3", r.rows[0].r);
n = await db.query("select attempts from public.free_extraction_attempts where tenant_id=$1", [T]);
n.rows[0].attempts === 2
  ? ok("attempts row = 2 (refused attempt did not inflate count)")
  : bad("count", JSON.stringify(n.rows));

// 3. Attempt semantics: a 'failed' attempt (caller error after reserve) is NOT refunded -
//    the cap bounds attempts, never promises successes. Simulate by reserving once more at cap 3.
r = await db.query("select public.reserve_free_extraction_attempt($1, 3) as r", [T]);
r.rows[0].r === "reserved" ? ok("attempt 3 reserved at cap 3") : bad("a3b", r.rows[0].r);
r = await db.query("select public.reserve_free_extraction_attempt($1, 3) as r", [T]);
r.rows[0].r === "over_cap"
  ? ok("attempt 4 refused: failed/consumed attempt still counted")
  : bad("a4", r.rows[0].r);

// 4. Day rollover: a row for yesterday (Pacific) does not count against today
await db.query(
  "insert into public.free_extraction_attempts values ($1, ((now() at time zone 'America/Los_Angeles')::date - 1), 99)",
  ["22222222-2222-2222-2222-222222222222"],
);
await db.query(
  "insert into public.user_roles values ('a0000000-0000-0000-0000-0000000000a1','22222222-2222-2222-2222-222222222222','admin')",
);
r = await db.query("select public.reserve_free_extraction_attempt($1, 1) as r", [
  "22222222-2222-2222-2222-222222222222",
]);
r.rows[0].r === "reserved"
  ? ok("yesterday's 99 attempts do not carry into today (Pacific day boundary)")
  : bad("rollover", r.rows[0].r);

// 5. RLS: authenticated has no direct table access (zero policies); RPC-only surface
await db.query("set role authenticated");
let denied = false;
try {
  await db.query("select * from public.free_extraction_attempts");
} catch (e) {
  denied = /permission denied|row-level security/i.test(String(e));
}
denied
  ? ok("authenticated direct SELECT denied (RLS, zero policies)")
  : bad("rls select", "not denied");
await db.query("reset role");

// 6. Grants: anon EXECUTE denied, authenticated EXECUTE allowed
await db.query("set role anon");
denied = false;
try {
  await db.query("select public.reserve_free_extraction_attempt($1, 1)", [T]);
} catch (e) {
  denied = /permission denied/i.test(String(e));
}
denied ? ok("anon EXECUTE denied") : bad("anon exec", "not denied");
await db.query("reset role");
await db.query("set role authenticated");
await db.query(`SET app.test_uid = 'a0000000-0000-0000-0000-0000000000a1'`);
r = await db.query("select public.reserve_free_extraction_attempt($1, 99) as r", [T]);
r.rows[0].r === "reserved"
  ? ok("authenticated EXECUTE allowed")
  : bad("auth exec", JSON.stringify(r.rows));
await db.query("reset role");

// 7. Membership: non-member tenant refused
r = await db.query(`SET app.test_uid = ''`);
let forb = false;
try {
  await db.query("select public.reserve_free_extraction_attempt($1, 1)", [T]);
} catch (e) {
  forb = /FORBIDDEN/i.test(String(e));
}
forb ? ok("non-member FORBIDDEN") : bad("forbidden", "not raised");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
