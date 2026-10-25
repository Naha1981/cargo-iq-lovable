// PGlite test for 20261024220000_spend_reservation.sql (atomic cap reservation).
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
create function public.is_tenant_member(t uuid) returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from public.user_roles where tenant_id = t and user_id = auth.uid()) $$;
create table public.commercial_rules(tenant_id uuid, rule_type text, payload jsonb, active boolean);
create table public.cases(id uuid primary key, tenant_id uuid);
create table public.documents(id uuid primary key, tenant_id uuid);
insert into public.tenants values ('11111111-1111-1111-1111-111111111111','A');
insert into public.user_roles values ('a0000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','admin');
`);
await db.exec(readFileSync(new URL("../supabase/migrations/20261024218000_extraction_usage.sql", import.meta.url), "utf8"));
await db.exec(readFileSync(new URL("../supabase/migrations/20261024220000_spend_reservation.sql", import.meta.url), "utf8"));
await db.query(`SET app.test_uid = 'a0000000-0000-0000-0000-0000000000a1'`);
const T = "11111111-1111-1111-1111-111111111111";

// 1. No cap configured: no_cap, no reservation row, behavior unchanged
let r = await db.query("select public.reserve_extraction_cost($1, gen_random_uuid(), 0.05) as r", [T]);
r.rows[0].r === "no_cap" ? ok("no cap -> no_cap") : bad("no cap", r.rows[0].r);
let n = await db.query("select count(*)::int as n from public.extraction_usage");
n.rows[0].n === 0 ? ok("no_cap writes nothing") : bad("no_cap row", n.rows[0].n);

// 2. Cap 0.10: reserve 0.06 ok; a second 0.05 reservation (0.06+0.05>0.10) refused atomically
await db.query("insert into public.commercial_rules values ($1,'AI_SPEND_CAP','{\"monthly_usd\":0.10}',true)", [T]);
const rid1 = "d0000000-0000-0000-0000-000000000001";
r = await db.query("select public.reserve_extraction_cost($1, $2, 0.06) as r", [T, rid1]);
r.rows[0].r === "reserved" ? ok("reservation under cap accepted") : bad("reserve1", r.rows[0].r);
r = await db.query("select public.reserve_extraction_cost($1, gen_random_uuid(), 0.05) as r", [T]);
r.rows[0].r === "over_cap" ? ok("concurrent second reservation over cap refused") : bad("over_cap", r.rows[0].r);
n = await db.query("select count(*)::int as n from public.extraction_usage where status='reserved'");
n.rows[0].n === 1 ? ok("refused reservation wrote no row") : bad("refused row", n.rows[0].n);

// 3. Completion replaces the reservation with actual (lower) cost; budget freed
await db.query("select public.complete_extraction_cost($1,$2,null,null,'openai','gpt-4o-mini',1000,500,0.00045)", [T, rid1]);
r = await db.query("select public.reserve_extraction_cost($1, $2, 0.05) as r", [T, "d0000000-0000-0000-0000-000000000002"]);
r.rows[0].r === "reserved" ? ok("completed actual cost frees reserved headroom") : bad("after complete", r.rows[0].r);

// 4. Void frees the reservation
await db.query("select public.void_extraction_reservation($1,$2)", [T, "d0000000-0000-0000-0000-000000000002"]);
r = await db.query("select public.reserve_extraction_cost($1, gen_random_uuid(), 0.09) as r", [T]);
r.rows[0].r === "reserved" ? ok("voided reservation frees budget") : bad("after void", r.rows[0].r);

// 5. Reconcile REPORTS stale reservations (>1h) but does NOT release them: a timed-out
// call may still have been billed, so its reservation keeps counting against the cap.
await db.query("update public.extraction_usage set reserved_at = now() - interval '2 hours' where status='reserved'");
r = await db.query("select public.reconcile_extraction_reservations() as r");
(r.rows[0].r.length === 1 && r.rows[0].r[0].reserved_cost_usd == 0.09) ? ok("reconcile reports stale reservation") : bad("reconcile", JSON.stringify(r.rows));
n = await db.query("select count(*)::int as n from public.extraction_usage where status='reserved'");
n.rows[0].n === 1 ? ok("stale reservation retained, still counting against cap") : bad("stale retained", n.rows[0].n);
r = await db.query("select public.reserve_extraction_cost($1, gen_random_uuid(), 0.02) as r", [T]);
r.rows[0].r === "over_cap" ? ok("stale reservation still blocks budget (0.00045+0.09+0.02 > 0.10)") : bad("stale blocks", r.rows[0].r);

// 6. Completion settles a stale reservation in place (invoice reconciled) and frees budget
await db.query("select public.complete_extraction_cost($1,$2,null,null,'openai','gpt-4o-mini',100,50,0.0001)", [T, "d0000000-0000-0000-0000-000000000002"]);
r = await db.query("select status from public.extraction_usage where request_id='d0000000-0000-0000-0000-000000000002'");
r.rows[0].status === "completed" ? ok("completion settles stale reservation in place") : bad("late completion", JSON.stringify(r.rows));
// 6b. Completion with NO reservation row at all still records spend (insert fallback)
await db.query("select public.complete_extraction_cost($1,$2,null,null,'openai','gpt-4o-mini',100,50,0.0001)", [T, "d0000000-0000-0000-0000-000000000099"]);
r = await db.query("select status from public.extraction_usage where request_id='d0000000-0000-0000-0000-000000000099'");
r.rows[0].status === "completed" ? ok("completion without reservation inserts fresh ledger row") : bad("orphan completion", JSON.stringify(r.rows));

// 7. Non-member forbidden
await db.query(`SET app.test_uid = 'b0000000-0000-0000-0000-0000000000b1'`);
try { await db.query("select public.reserve_extraction_cost($1, gen_random_uuid(), 0.01)", [T]); bad("non-member", "succeeded"); }
catch (e) { String(e.message).includes("FORBIDDEN") ? ok("non-member forbidden") : bad("non-member", e.message); }
console.log(fail === 0 ? `ALL ${pass} PASSED` : `${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
