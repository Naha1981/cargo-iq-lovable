// PGlite test for 20261025120000_tenant_invitations.sql (safe team invitations).
// Properties under test: email binding, single use, expiry, INSERT-only
// membership (no silent role change), admin-only create/list/revoke, grants.
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
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', nullif(current_setting('app.test_email', true),'')) $$;
create table public.tenants(id uuid primary key, name text);
create table public.user_roles(user_id uuid, tenant_id uuid, role text);
insert into public.tenants values ('11111111-1111-1111-1111-111111111111','Alpha');
insert into public.user_roles values ('a0000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','admin');
`);
await db.exec(readFileSync(new URL("../supabase/migrations/20261025120000_tenant_invitations.sql", import.meta.url), "utf8"));
const T = "11111111-1111-1111-1111-111111111111";
const ADMIN = "a0000000-0000-0000-0000-0000000000a1";
const NEW = "b0000000-0000-0000-0000-0000000000b2";
const OTHER = "c0000000-0000-0000-0000-0000000000c3";
const asUser = async (uid, email) => {
  await db.query(`SET app.test_uid = '${uid}'`);
  await db.query(`SET app.test_email = '${email}'`);
};
const t = async (name, fn) => { try { await fn(); ok(name); } catch (e) { bad(name, e.message || e); } };
const expectErr = async (p, frag) => { try { await p; throw new Error("no error thrown"); } catch (e) { if (!(e.message || "").includes(frag)) throw e; } };

await asUser(NEW, "new@example.com");
await t("create requires tenant admin", () =>
  expectErr(db.query("select public.create_tenant_invitation($1,$2,$3)", [T, "x@example.com", "viewer"]), "FORBIDDEN"));
await asUser(ADMIN, "owner@example.com");
await t("invalid role rejected", () =>
  expectErr(db.query("select public.create_tenant_invitation($1,$2,$3)", [T, "x@example.com", "superuser"]), "INVALID_ROLE"));
await t("invalid email rejected", () =>
  expectErr(db.query("select public.create_tenant_invitation($1,$2,$3)", [T, "not-an-email", "viewer"]), "INVALID_EMAIL"));
let token;
await t("admin creates invitation", async () => {
  const r = await db.query("select public.create_tenant_invitation($1,$2,$3) as r", [T, "New@Example.com", "investigator"]);
  token = r.rows[0].r.token;
  if (!token) throw new Error("no token");
});
await t("list is admin-only and shows pending", async () => {
  await asUser(NEW, "new@example.com");
  await expectErr(db.query("select public.list_tenant_invitations($1)", [T]), "FORBIDDEN");
  await asUser(ADMIN, "owner@example.com");
  const r = await db.query("select public.list_tenant_invitations($1) as r", [T]);
  if (!JSON.stringify(r.rows[0].r).includes("new@example.com")) throw new Error("not listed/lowercased");
});
await asUser(OTHER, "other@example.com");
await t("wrong email cannot accept (email_mismatch, invitation unclaimed)", async () => {
  const r = await db.query("select public.accept_tenant_invitation($1) as r", [token]);
  if (r.rows[0].r !== "email_mismatch") throw new Error("got " + r.rows[0].r);
});
await asUser(NEW, "new@example.com");
await t("matching email joins with invited role", async () => {
  const r = await db.query("select public.accept_tenant_invitation($1) as r", [token]);
  if (r.rows[0].r !== "joined") throw new Error("got " + r.rows[0].r);
  const m = await db.query("select role from public.user_roles where user_id=$1 and tenant_id=$2", [NEW, T]);
  if (m.rows[0]?.role !== "investigator") throw new Error("role " + m.rows[0]?.role);
});
await t("replay is invalid_or_expired (single use)", async () => {
  const r = await db.query("select public.accept_tenant_invitation($1) as r", [token]);
  if (r.rows[0].r !== "invalid_or_expired") throw new Error("got " + r.rows[0].r);
});
let token2;
await asUser(ADMIN, "owner@example.com");
await t("second invitation for existing member says already_member and keeps original role", async () => {
  const r = await db.query("select public.create_tenant_invitation($1,$2,$3) as r", [T, "new@example.com", "viewer"]);
  token2 = r.rows[0].r.token;
  await asUser(NEW, "new@example.com");
  const a = await db.query("select public.accept_tenant_invitation($1) as r", [token2]);
  if (a.rows[0].r !== "already_member") throw new Error("got " + a.rows[0].r);
  const m = await db.query("select role from public.user_roles where user_id=$1 and tenant_id=$2", [NEW, T]);
  if (m.rows[0]?.role !== "investigator") throw new Error("role silently changed to " + m.rows[0]?.role);
});
await t("expired invitation cannot be accepted", async () => {
  await asUser(ADMIN, "owner@example.com");
  const r = await db.query("select public.create_tenant_invitation($1,$2,$3) as r", [T, "late@example.com", "viewer"]);
  const tk = r.rows[0].r.token;
  await db.query("update public.tenant_invitations set expires_at = now() - interval '1 hour' where token=$1", [tk]);
  await asUser(OTHER, "late@example.com");
  const a = await db.query("select public.accept_tenant_invitation($1) as r", [tk]);
  if (a.rows[0].r !== "invalid_or_expired") throw new Error("got " + a.rows[0].r);
});
await t("anon cannot execute invitation functions", async () => {
  await db.query("SET ROLE anon");
  await expectErr(db.query("select public.list_tenant_invitations($1)", [T]), "permission denied");
  await db.query("RESET ROLE");
});
await t("revoke removes pending invitation", async () => {
  await asUser(ADMIN, "owner@example.com");
  const r = await db.query("select public.create_tenant_invitation($1,$2,$3) as r", [T, "gone@example.com", "viewer"]);
  const id = r.rows[0].r.id;
  const d = await db.query("select public.revoke_tenant_invitation($1) as r", [id]);
  if (d.rows[0].r !== "revoked") throw new Error("got " + d.rows[0].r);
  const l = await db.query("select public.list_tenant_invitations($1) as r", [T]);
  if (JSON.stringify(l.rows[0].r).includes("gone@example.com")) throw new Error("still listed");
});
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
