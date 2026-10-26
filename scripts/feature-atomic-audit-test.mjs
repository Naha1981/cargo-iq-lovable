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
await db.exec("reset role");
await db.exec(
  readFileSync(new URL("../docs/proposals/feature_atomic_audit.sql", import.meta.url), "utf8"),
);
await db.exec(`set role authenticated; set app.uid='${U}'`);
let passed = 0;
async function test(name, fn) {
  await fn();
  console.log("PASS", name);
  passed++;
}
const F = "f0000000-0000-0000-0000-000000000001";
await test("entity insert creates actor-bound audit in same transaction", async () => {
  await db.exec(
    `insert into recovery_findings(id,tenant_id,case_id,finding_type,title,created_by) values ('${F}','${A}','${C}','missed_billing','fixture','${U}')`,
  );
  const a = (await db.query(`select * from recovery_finding_events`)).rows;
  assert.equal(a.length, 1);
  assert.equal(a[0].actor, U);
  assert.equal(a[0].detail.after.id, F);
});
await test("client cannot fabricate audit rows", async () => {
  await assert.rejects(
    () =>
      db.exec(
        `insert into recovery_finding_events(tenant_id,finding_id,action,actor) values ('${A}','${F}','fake','${U}')`,
      ),
    /row-level security/,
  );
});
await test("invalid status transition rolls back entity and audit", async () => {
  await assert.rejects(
    () => db.exec(`update recovery_findings set status='recovered' where id='${F}'`),
    /INVALID_RECOVERY_TRANSITION/,
  );
  assert.equal((await db.query(`select status from recovery_findings`)).rows[0].status, "new");
  assert.equal(
    (await db.query(`select count(*)::int n from recovery_finding_events`)).rows[0].n,
    1,
  );
});
await test("forced audit storage error rolls back parent update", async () => {
  await db.exec(
    `reset role; alter table recovery_finding_events add constraint injected_failure check (action <> 'status_changed'); set role authenticated`,
  );
  await assert.rejects(
    () => db.exec(`update recovery_findings set status='under_review' where id='${F}'`),
    /injected_failure/,
  );
  assert.equal((await db.query(`select status from recovery_findings`)).rows[0].status, "new");
  await db.exec(
    `reset role; alter table recovery_finding_events drop constraint injected_failure; set role authenticated`,
  );
});
await test("retry after failure produces exactly one transition and audit", async () => {
  const sql = `update recovery_findings set status='under_review' where id='${F}' and status='new' returning id`;
  assert.equal((await db.query(sql)).rows.length, 1);
  assert.equal((await db.query(sql)).rows.length, 0);
  assert.equal(
    (await db.query(`select count(*)::int n from recovery_finding_events`)).rows[0].n,
    2,
  );
});
await test("creator spoofing rejected", async () => {
  await assert.rejects(
    () =>
      db.exec(
        `insert into scene_assets(tenant_id,name,source_type,created_by) values ('${A}','fixture','ply','${W}')`,
      ),
    /CREATOR_MUST_MATCH_ACTOR/,
  );
});
await test("transaction rollback removes inserted entity and audit", async () => {
  await db.exec(
    `begin; insert into scene_assets(tenant_id,name,source_type,created_by) values ('${A}','rolled back','ply','${U}'); rollback`,
  );
  assert.equal((await db.query(`select * from scene_assets`)).rows.length, 0);
  assert.equal((await db.query(`select * from scene_asset_events`)).rows.length, 0);
});
await db.exec("reset role");
await db.exec(
  readFileSync(new URL("../docs/proposals/recovery_comparison_batch.sql", import.meta.url), "utf8"),
);
await db.exec(`set role authenticated; set app.uid='${U}'`);
const req = "b0000000-0000-0000-0000-000000000001";
const rows = [
  {
    case_id: C,
    finding_type: "missed_billing",
    title: "batch fixture",
    currency: "ZAR",
    calculation: { difference: 10 },
    source_document_ids: [],
    evidence_refs: [],
  },
];
const runBatch = (rs = rows) =>
  db.query("select * from cargoiq_create_recovery_batch($1,$2,$3::jsonb)", [
    A,
    req,
    JSON.stringify(rs),
  ]);
await test("batch retry returns identical IDs with no extra audit", async () => {
  const one = await runBatch();
  const two = await runBatch();
  assert.equal(one.rows[0].id, two.rows[0].id);
  const n = await db.query(
    `select count(*)::int n from recovery_finding_events where finding_id='${one.rows[0].id}'`,
  );
  assert.equal(n.rows[0].n, 1);
});
await test("request key reused for different content refused", async () => {
  await assert.rejects(() => runBatch([{ ...rows[0], title: "different" }]), /REQUEST_KEY_REUSED/);
});
await test("invalid second row rolls back entire batch and audit", async () => {
  const count = async (table) => (await db.query(`select count(*)::int n from ${table}`)).rows[0].n;
  const before = await count("recovery_findings"),
    audits = await count("recovery_finding_events");
  await assert.rejects(
    () =>
      db.query("select * from cargoiq_create_recovery_batch($1,$2,$3::jsonb)", [
        A,
        "b0000000-0000-0000-0000-000000000002",
        JSON.stringify([rows[0], { ...rows[0], case_id: D }]),
      ]),
    /row-level security/,
  );
  assert.equal(await count("recovery_findings"), before);
  assert.equal(await count("recovery_finding_events"), audits);
});
await test("batch identity cannot be erased to defeat replay", async () => {
  const row = (await runBatch()).rows[0];
  await assert.rejects(
    () => db.query("update recovery_findings set calculation='{}'::jsonb where id=$1", [row.id]),
    /IMMUTABLE_COMPARISON_REQUEST/,
  );
  assert.equal((await runBatch()).rows[0].id, row.id);
});
await test("overlapping retry calls return one batch identity", async () => {
  const replies = await Promise.all(Array.from({ length: 8 }, () => runBatch()));
  assert.equal(new Set(replies.map((r) => r.rows[0].id)).size, 1);
  const n = await db.query(
    `select count(*)::int n from recovery_findings where calculation->>'request_id'='${req}'`,
  );
  assert.equal(n.rows[0].n, 1);
});
console.log(`${passed} atomic-audit assertions passed locally. Proposal not applied remotely.`);
await db.close();
