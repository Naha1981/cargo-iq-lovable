#!/usr/bin/env node
// Synthetic 50-tenant capacity-test seed for the CargoIQ STAGING project.
// Creates N tenants (SYNTH-CAP-001..N), N auth users via the GoTrue admin API
// (the supported route - verified 25 Oct 2026), and one admin user_roles row
// each. `down` removes exactly what `up` created, in reverse, via supported
// paths only. Safe to re-run: existing rows/users are skipped by name/email.
//
// Usage:
//   API=https://<ref>.supabase.co SVC=<service_role secret> \
//   PGHOST=... PGUSER=... PGPASSWORD=... PGDATABASE=postgres PGSSLMODE=require \
//   node scripts/capacity-seed.mjs up 50 | down | status
//
// SYNTHETIC STAGING ONLY. Never point this at the live project.
import { execFileSync } from "node:child_process";

const { API, SVC } = process.env;
for (const k of ["API", "SVC", "PGHOST", "PGUSER", "PGPASSWORD"])
  if (!process.env[k]) { console.error(k + " is required"); process.exit(2); }
const CMD = process.argv[2], N = Number(process.argv[3] ?? 50);
if (!["up", "down", "status"].includes(CMD)) { console.error("up|down|status"); process.exit(2); }
const name = (i) => "SYNTH-CAP-" + String(i).padStart(3, "0");
const email = (i) => "synth-cap-" + String(i).padStart(3, "0") + "@cargoiq-staging.invalid";

const sql = (q) =>
  execFileSync("psql", ["-X", "-q", "-t", "-A", "-c", q], { encoding: "utf8" }).trim();

async function admin(path, method, body) {
  const r = await fetch(API + "/auth/v1/admin/" + path, {
    method,
    headers: { apikey: SVC, Authorization: "Bearer " + SVC, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(method + " " + path + " -> " + r.status + " " + (await r.text()).slice(0, 200));
  return r.status === 204 ? null : r.json();
}

if (CMD === "status") {
  console.log("tenants: " + sql("select count(*) from public.tenants where name like 'SYNTH-CAP-%'"));
  console.log("roles:   " + sql("select count(*) from public.user_roles ur join public.tenants t on t.id=ur.tenant_id where t.name like 'SYNTH-CAP-%'"));
  process.exit(0);
}

if (CMD === "up") {
  for (let i = 1; i <= N; i++) {
    // tenants.name has no unique constraint: existence-check first so re-runs never duplicate.
    const tid =
      sql("select id from public.tenants where name='" + name(i) + "'") ||
      sql("insert into public.tenants (name) values ('" + name(i) + "') returning id");
    let uid;
    try {
      uid = (await admin("users", "POST", { email: email(i), password: "synth-not-used", email_confirm: true, user_metadata: { synthetic: true } })).id;
    } catch (e) {
      if (!String(e.message).includes("already")) throw e;
      uid = null; // resolved below
    }
    if (!uid)
      uid = sql("select id from auth.users where email='" + email(i) + "'");
    sql("insert into public.user_roles (user_id, tenant_id, role) values ('" + uid + "','" + tid + "','admin') on conflict do nothing");
    if (i % 10 === 0) console.log(i + "/" + N);
  }
  console.log("up complete");
}

if (CMD === "down") {
  const rows = sql(
    "select ur.user_id from public.user_roles ur join public.tenants t on t.id=ur.tenant_id where t.name like 'SYNTH-CAP-%'",
  ).split("\n").filter(Boolean);
  sql("delete from public.user_roles where tenant_id in (select id from public.tenants where name like 'SYNTH-CAP-%')");
  sql("delete from public.tenants where name like 'SYNTH-CAP-%'");
  for (const uid of rows) await admin("users/" + uid, "DELETE");
  console.log("down complete: " + rows.length + " users deleted");
}
