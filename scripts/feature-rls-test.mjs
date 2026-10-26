// Isolated local PostgreSQL-compatible proof. No external DB/network access.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const db = new PGlite();
const A = "11111111-1111-1111-1111-111111111111",
  B = "22222222-2222-2222-2222-222222222222";
const U = "a0000000-0000-0000-0000-000000000001",
  V = "a0000000-0000-0000-0000-000000000002",
  W = "a0000000-0000-0000-0000-000000000003";
const C = "c0000000-0000-0000-0000-000000000001",
  D = "c0000000-0000-0000-0000-000000000002";
await db.exec(`create role authenticated nologin; create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid',true),'')::uuid $$;
create table tenants(id uuid primary key); create table cases(id uuid primary key,tenant_id uuid);
create table user_roles(user_id uuid,tenant_id uuid,role text); create table documents(id uuid primary key,tenant_id uuid,case_id uuid); create table timeline_events(id uuid primary key,tenant_id uuid,case_id uuid);
insert into tenants values ('${A}'),('${B}'); insert into cases values ('${C}','${A}'),('${D}','${B}');
insert into user_roles values ('${U}','${A}','investigator'),('${V}','${A}','viewer'),('${W}','${B}','admin');`);
for (const name of [
  "20261026140000_simulation_lab.sql",
  "20261026150000_revenue_recovery.sql",
  "20261026160000_scene_gehi.sql",
])
  await db.exec(readFileSync(new URL("../supabase/migrations/" + name, import.meta.url), "utf8"));
await db.exec(
  `grant usage on schema public,auth to authenticated; grant select,insert,update,delete on all tables in schema public to authenticated; set role authenticated; set app.uid='${U}';`,
);
let passed = 0;
async function test(name, fn) {
  await fn();
  console.log("PASS", name);
  passed++;
}
async function denied(sql) {
  await assert.rejects(() => db.exec(sql), /row-level security/);
}
const F = "f0000000-0000-0000-0000-000000000001";
await test("investigator can create own finding", () =>
  db.exec(
    `insert into recovery_findings(id,tenant_id,case_id,finding_type,title) values ('${F}','${A}','${C}','missed_billing','Local fixture')`,
  ));
await test("cross-tenant case association refused", () =>
  denied(
    `insert into recovery_findings(tenant_id,case_id,finding_type,title) values ('${A}','${D}','missed_billing','no')`,
  ));
await test("cross-tenant assignee refused", () =>
  denied(`update recovery_findings set assigned_to='${W}' where id='${F}'`));
await test("same-tenant eligible owner accepted", () =>
  db.exec(`update recovery_findings set assigned_to='${U}' where id='${F}'`));
await test("audit insertion accepts bound actor/parent", () =>
  db.exec(
    `insert into recovery_finding_events(tenant_id,finding_id,action,actor) values ('${A}','${F}','created','${U}')`,
  ));
await test("spoofed audit actor refused", () =>
  denied(
    `insert into recovery_finding_events(tenant_id,finding_id,action,actor) values ('${A}','${F}','fake','${W}')`,
  ));
await test("cross-tenant audit parent refused", () =>
  denied(
    `insert into recovery_finding_events(tenant_id,finding_id,action,actor) values ('${B}','${F}','fake','${U}')`,
  ));
await test("audit update/delete affect zero rows", async () => {
  assert.equal(
    (await db.query(`update recovery_finding_events set action='tamper' returning id`)).rows.length,
    0,
  );
  assert.equal((await db.query(`delete from recovery_finding_events returning id`)).rows.length, 0);
  assert.equal((await db.query(`select * from recovery_finding_events`)).rows.length, 1);
});
await db.exec(`set app.uid='${V}'`);
await test("viewer can read own finding but cannot insert", async () => {
  assert.equal((await db.query(`select id from recovery_findings`)).rows.length, 1);
  await denied(
    `insert into recovery_findings(tenant_id,finding_type,title) values ('${A}','missed_billing','no')`,
  );
});
await test("viewer cannot update/delete own finding", async () => {
  assert.equal(
    (await db.query(`update recovery_findings set title='no' returning id`)).rows.length,
    0,
  );
  assert.equal((await db.query(`delete from recovery_findings returning id`)).rows.length, 0);
});
await db.exec(`set app.uid='${W}'`);
await test("other tenant cannot read finding or audit", async () => {
  assert.equal((await db.query(`select id from recovery_findings`)).rows.length, 0);
  assert.equal((await db.query(`select id from recovery_finding_events`)).rows.length, 0);
});
await test("other tenant cannot create scene/gehi for foreign case", async () => {
  await denied(
    `insert into scene_assets(tenant_id,case_id,name,source_type) values ('${B}','${C}','no','ply')`,
  );
  await denied(
    `insert into geospatial_findings(tenant_id,case_id,title,source,method) values ('${B}','${C}','no','fixture','manual')`,
  );
});
console.log(
  `${passed} local RLS assertions passed. Append-only is not automatic/transactional audit completeness.`,
);
await db.close();
