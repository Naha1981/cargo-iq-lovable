// PGlite test for 20261025200000_tenant_free_cap_overrides.sql (owner-settable per-tenant caps).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("PASS", n); };
const bad = (n, e) => { fail++; console.log("FAIL", n, "-", e); };
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
await db.exec(readFileSync(new URL("../supabase/migrations/20261024221000_free_extraction_daily_cap.sql", import.meta.url), "utf8"));
await db.exec(readFileSync(new URL("../supabase/migrations/20261025200000_tenant_free_cap_overrides.sql", import.meta.url), "utf8"));
await db.query(`SET app.test_uid = 'a0000000-0000-0000-0000-0000000000a1'`);
const T = "11111111-1111-1111-1111-111111111111";

// 1. No override: env default semantics unchanged (0 fails closed, 2 reserves twice then over_cap)
let r = await db.query("select public.reserve_free_extraction_attempt($1, 0) as r", [T]);
r.rows[0].r === "no_cap_configured" ? ok("no override + cap 0 -> no_cap_configured") : bad("noov0", r.rows[0].r);
r = await db.query("select public.reserve_free_extraction_attempt($1, 2) as r", [T]);
r = await db.query("select public.reserve_free_extraction_attempt($1, 2) as r", [T]);
r = await db.query("select public.reserve_free_extraction_attempt($1, 2) as r", [T]);
r.rows[0].r === "over_cap" ? ok("no override: default cap still enforced") : bad("noov2", r.rows[0].r);

// 2. Owner sets override 5 for T: attempts 3-5 reserve, 6th refused (override wins over passed default 2)
r = await db.query("select public.admin_set_tenant_free_cap($1, 5) as r", [T]);
r = await db.query("select public.reserve_free_extraction_attempt($1, 2) as r", [T]);
r.rows[0].r === "reserved" ? ok("override 5 wins over passed default 2 (3rd attempt reserved)") : bad("ov3", r.rows[0].r);
await db.query("select public.reserve_free_extraction_attempt($1, 2)", [T]);
await db.query("select public.reserve_free_extraction_attempt($1, 2)", [T]);
r = await db.query("select public.reserve_free_extraction_attempt($1, 2) as r", [T]);
r.rows[0].r === "over_cap" ? ok("6th attempt refused at override cap 5") : bad("ov6", r.rows[0].r);

// 3. Owner override applies even when env default is invalid (0): deliberate config beats fail-closed default
await db.query("update public.free_extraction_attempts set attempts = 0 where tenant_id=$1", [T]);
r = await db.query("select public.reserve_free_extraction_attempt($1, 0) as r", [T]);
r.rows[0].r === "reserved" ? ok("owner override 5 applies with invalid env default (0)") : bad("ovenv", r.rows[0].r);

// 4. Clear override (NULL): env default applies again; fail-closed 0 returns
r = await db.query("select public.admin_set_tenant_free_cap($1, NULL) as r", [T]);
JSON.stringify(r.rows[0].r).includes('"daily_attempts":null') ? ok("clear override returns NULL cap") : bad("clr", JSON.stringify(r.rows[0].r));
r = await db.query("select public.reserve_free_extraction_attempt($1, 0) as r", [T]);
r.rows[0].r === "no_cap_configured" ? ok("after clear, invalid env default fails closed again") : bad("clr0", r.rows[0].r);

// 5. Invalid overrides rejected: 0, negative, 10001, non-tenant
let rejected = 0;
for (const v of [0, -4, 10001]) {
  try { await db.query("select public.admin_set_tenant_free_cap($1, $2)", [T, v]); } catch (e) { if (/INVALID_CAP/.test(String(e))) rejected++; }
}
try { await db.query("select public.admin_set_tenant_free_cap('33333333-3333-3333-3333-333333333333', 5)"); } catch (e) { if (/UNKNOWN_TENANT/.test(String(e))) rejected++; }
rejected === 4 ? ok("0/negative/10001/unknown-tenant all rejected") : bad("invalids", rejected);

// 6. Non-owner cannot set caps (same opaque denial as other admin functions)
await db.query(`SET app.test_uid = 'b0000000-0000-0000-0000-0000000000b2'`);
let denied = false;
try { await db.query("select public.admin_set_tenant_free_cap($1, 5)", [T]); } catch (e) { denied = /FORBIDDEN/.test(String(e)); }
denied ? ok("non-owner set denied") : bad("nonowner set", "not denied");
denied = false;
try { await db.query("select public.admin_list_tenant_free_caps()"); } catch (e) { denied = /FORBIDDEN/.test(String(e)); }
denied ? ok("non-owner list denied") : bad("nonowner list", "not denied");
await db.query(`SET app.test_uid = 'a0000000-0000-0000-0000-0000000000a1'`);

// 7. Owner list shows override + today's usage per workspace
await db.query("select public.admin_set_tenant_free_cap($1, 7)", [T]);
await db.query("select public.reserve_free_extraction_attempt($1, 10)", [T]);
r = await db.query("select public.admin_list_tenant_free_caps() as r");
const rows = r.rows[0].r.rows;
const alpha = rows.find((x) => x.tenant_id === T);
(alpha && alpha.override === 7 && alpha.attempts_today === 2 && rows.length === 2 && r.rows[0].r.total === 2)
  ? ok("owner list: override 7, attempts_today 2 (steps 3+7 reserves), 2 workspaces, total 2")
  : bad("list", JSON.stringify(r.rows[0].r));

// 8. RLS: no direct table access; anon EXECUTE denied on both new functions
await db.query("set role authenticated");
denied = false;
try { await db.query("select * from public.tenant_free_caps"); } catch (e) { denied = /permission denied|row-level security/i.test(String(e)); }
denied ? ok("authenticated direct SELECT on tenant_free_caps denied") : bad("rls caps", "not denied");
await db.query("reset role");
await db.query("set role anon");
denied = false;
try { await db.query("select public.admin_set_tenant_free_cap($1, 5)", [T]); } catch (e) { denied = /permission denied/i.test(String(e)); }
denied ? ok("anon set EXECUTE denied") : bad("anon set", "not denied");
denied = false;
try { await db.query("select public.admin_list_tenant_free_caps()"); } catch (e) { denied = /permission denied/i.test(String(e)); }
denied ? ok("anon list EXECUTE denied") : bad("anon list", "not denied");
await db.query("reset role");

console.log(fail === 0 ? `ALL ${pass} PASSED` : `${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
