import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const mig = readFileSync("supabase/migrations/20261024212000_provisioning_atomicity.sql","utf8");
let pass = 0, fail = 0;
const ok = n => { pass++; console.log("PASS", n); };
const bad = (n, e) => { fail++; console.log("FAIL", n, "-", e); };
const mk = async () => {
  const db = new PGlite();
  await db.query('create role authenticated nologin'); await db.query('create role anon nologin');
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_uid', true),'')::uuid $$;
    create table public.tenants(id uuid primary key default gen_random_uuid(), name text);
    create table public.user_roles(user_id uuid, tenant_id uuid, role text, created_at timestamptz default now());
    create function public.seed_demo_case(uuid, uuid) returns uuid language plpgsql as $$ begin return gen_random_uuid(); end $$;
  `);
  return db;
};
const U1 = '11111111-1111-4111-8111-111111111111';
{
  const db = await mk();
  await db.exec(mig);
  await db.query("select set_config('app.test_uid',$1,false)", [U1]);
  const a = (await db.query("select public.provision_organization('Acme') as t")).rows[0].t;
  const b = (await db.query("select public.provision_organization('Acme') as t")).rows[0].t;
  a === b ? ok("double provisioning returns same tenant (lock + recheck)") : bad("double provisioning", a + " vs " + b);
  const n = (await db.query("select count(*)::int c from public.tenants")).rows[0].c;
  n === 1 ? ok("exactly one tenant exists") : bad("one tenant", String(n));
  // membership semantics unchanged: a second role/membership row for the same user is still allowed
  try {
    await db.query("insert into public.user_roles(user_id,tenant_id,role) values ($1, gen_random_uuid(), 'viewer')", [U1]);
    ok("multiple memberships still allowed (no new product restriction)");
  } catch (e) { bad("multiple memberships still allowed", e.message); }
}
{
  const db = await mk();
  await db.exec(mig);
  try { await db.query("select public.provision_organization(null)"); bad("unauthenticated refused", "succeeded"); }
  catch (e) { String(e.message).includes("UNAUTHENTICATED") ? ok("unauthenticated refused") : bad("unauthenticated refused", e.message); }
}
console.log(fail === 0 ? `ALL ${pass} PASS` : `${fail} FAILURES`);
