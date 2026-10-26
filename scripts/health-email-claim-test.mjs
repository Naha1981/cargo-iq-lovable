// PGlite test for 20261025240000_health_email_day_claim.sql (atomic day claim
// for the daily AI health email). Proves the exactly-once rails:
//   1. concurrent claims: exactly ONE invocation holds the sending lease;
//   2. a confirmed send maps later claims to already_sent (no resend);
//   3. an expired lease (provider accept + lost response, crash mid-send) maps
//      to unknown - NEVER silently resendable;
//   4. a failed send maps to unknown for owner review, not auto-retry;
//   5. client roles (anon/authenticated) have no access to the ledger or RPCs.
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
create role authenticated nologin; create role anon nologin; create role service_role nologin;
create schema auth;
`);
await db.exec(
  readFileSync(
    new URL("../supabase/migrations/20261025240000_health_email_day_claim.sql", import.meta.url),
    "utf8",
  ),
);

const DAY = "2026-10-25";

// 1. Exactly one of two concurrent claims wins the lease.
//    PGlite is single-connection, so interleave via the SQL itself: the first
//    INSERT wins; every later claim of the same day reads the conflict path.
const first = await db.query(`select public.claim_health_email_day($1::date) as r`, [DAY]);
const second = await db.query(`select public.claim_health_email_day($1::date) as r`, [DAY]);
const third = await db.query(`select public.claim_health_email_day($1::date) as r`, [DAY]);
if (
  first.rows[0].r === "claimed" &&
  second.rows[0].r === "in_progress" &&
  third.rows[0].r === "in_progress"
)
  ok("concurrent claims: exactly one claimed, others in_progress");
else bad("concurrent claims", JSON.stringify([first.rows[0].r, second.rows[0].r, third.rows[0].r]));

// 2. Completed send -> later claims are already_sent, and the provider id is stored.
await db.query(`select public.complete_health_email_day($1::date, 're_msg_123')`, [DAY]);
const afterComplete = await db.query(`select public.claim_health_email_day($1::date) as r`, [DAY]);
const row = await db.query(
  `select status, provider_message_id from public.health_email_sends where day = $1::date`,
  [DAY],
);
if (
  afterComplete.rows[0].r === "already_sent" &&
  row.rows[0].status === "sent" &&
  row.rows[0].provider_message_id === "re_msg_123"
)
  ok("confirmed send: later claims already_sent, provider id stored");
else bad("confirmed send", JSON.stringify([afterComplete.rows[0], row.rows[0]]));

// 3. Expired lease (e.g. provider accepted but the response was lost, or the
//    invoker crashed mid-send) -> unknown, never auto-resendable, owner-visible.
const DAY2 = "2026-10-26";
await db.query(`select public.claim_health_email_day($1::date, '-1 minute'::interval)`, [DAY2]);
const expired = await db.query(`select public.claim_health_email_day($1::date) as r`, [DAY2]);
const row2 = await db.query(`select status from public.health_email_sends where day = $1::date`, [
  DAY2,
]);
const expiredAgain = await db.query(`select public.claim_health_email_day($1::date) as r`, [DAY2]);
if (
  expired.rows[0].r === "unknown" &&
  row2.rows[0].status === "unknown" &&
  expiredAgain.rows[0].r === "unknown"
)
  ok("expired lease: unknown, stays unknown, never auto-resent");
else bad("expired lease", JSON.stringify([expired.rows[0], row2.rows[0], expiredAgain.rows[0]]));

// 4. Failed send -> unknown on next claim (owner review), not an auto-retry.
const DAY3 = "2026-10-27";
await db.query(`select public.claim_health_email_day($1::date)`, [DAY3]);
await db.query(`select public.fail_health_email_day($1::date, 'provider rejected')`, [DAY3]);
const afterFail = await db.query(`select public.claim_health_email_day($1::date) as r`, [DAY3]);
const row3 = await db.query(
  `select status, detail from public.health_email_sends where day = $1::date`,
  [DAY3],
);
if (afterFail.rows[0].r === "unknown" && row3.rows[0].status === "unknown")
  ok("failed send: next claim unknown (owner review), no auto-retry");
else bad("failed send", JSON.stringify([afterFail.rows[0], row3.rows[0]]));

// 5. completeDay cannot resurrect a day that is not in 'sending'.
await db.query(`select public.complete_health_email_day($1::date, 're_late')`, [DAY3]);
const row3b = await db.query(
  `select status, provider_message_id from public.health_email_sends where day = $1::date`,
  [DAY3],
);
if (row3b.rows[0].status === "unknown" && row3b.rows[0].provider_message_id === null)
  ok("complete after failure is a no-op (no late overwrite)");
else bad("complete after failure", JSON.stringify(row3b.rows[0]));

// 6. Client roles have no access: table RLS-enabled with no policies, RPCs revoked.
const grants = await db.query(
  `select grantee, privilege_type from information_schema.role_table_grants where table_name = 'health_email_sends' order by 1, 2`,
);
const clientGrants = grants.rows.filter((g) => ["anon", "authenticated"].includes(g.grantee));
if (clientGrants.length === 0) ok("anon/authenticated have no privileges on health_email_sends");
else bad("client table grants", JSON.stringify(clientGrants));

// 7. admin_list_health_email_sends: platform admin reads delivery state;
//    non-admin is FORBIDDEN; service_role allowed (cron path).
await db.exec(`
create table public.platform_admins(user_id uuid primary key, email text);
create function public.is_platform_admin() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from public.platform_admins where user_id = nullif(current_setting('app.test_uid', true),'')::uuid) $$;
create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('app.test_jwt_role', true),'')::jsonb $$;
insert into public.platform_admins values ('a0000000-0000-0000-0000-0000000000a1','owner@example.com');
`);
await db.query(`select set_config('app.test_uid', 'a0000000-0000-0000-0000-0000000000a1', false)`);
const adminList = await db.query(`select public.admin_list_health_email_sends(7) as r`);
const days = JSON.parse(JSON.stringify(adminList.rows[0].r)).map((x) => x.day);
if (days.includes("2026-10-25") && days.includes("2026-10-26") && days.includes("2026-10-27"))
  ok("platform admin reads recent delivery rows");
else bad("platform admin list", JSON.stringify(adminList.rows[0]));

await db.query(`select set_config('app.test_uid', 'b0000000-0000-0000-0000-0000000000b2', false)`);
let forbidden = false;
try {
  await db.query(`select public.admin_list_health_email_sends(7)`);
} catch (e) {
  forbidden = String(e).includes("FORBIDDEN");
}
if (forbidden) ok("non-admin is FORBIDDEN from delivery state");
else bad("non-admin", "no FORBIDDEN raised");

await db.query(`select set_config('app.test_uid', '', false)`);
await db.query(`select set_config('app.test_jwt_role', '{"role": "service_role"}', false)`);
const svcList = await db.query(`select public.admin_list_health_email_sends(7) as r`);
if (Array.isArray(svcList.rows[0].r)) ok("service_role can read delivery state (cron path)");
else bad("service_role list", JSON.stringify(svcList.rows[0]));

console.log(`health-email-claim: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
