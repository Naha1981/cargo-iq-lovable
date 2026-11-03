import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const db = new PGlite();
const migration = readFileSync(
  new URL("../supabase/migrations/20261102053000_dd_case_draft.sql", import.meta.url),
  "utf8",
);
const A = "11111111-1111-4111-8111-111111111111",
  B = "22222222-2222-4222-8222-222222222222",
  T = "33333333-3333-4333-8333-333333333333",
  C = "44444444-4444-4444-8444-444444444444",
  V = "55555555-5555-4555-8555-555555555555";
await db.exec(
  `create role anon;create role authenticated;create schema auth;grant usage on schema auth to authenticated;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;create table cases(id uuid primary key,tenant_id uuid);create table user_roles(user_id uuid,tenant_id uuid,role text);insert into cases values('${C}','${T}');insert into user_roles values('${A}','${T}','admin'),('${V}','${T}','viewer');grant select,update on cases to authenticated;grant select on user_roles to authenticated;alter table cases enable row level security;create policy member_read on cases for select to authenticated using(exists(select 1 from user_roles r where r.tenant_id=cases.tenant_id and r.user_id=auth.uid()));create policy member_write on cases for update to authenticated using(exists(select 1 from user_roles r where r.tenant_id=cases.tenant_id and r.user_id=auth.uid() and r.role in('admin','investigator')));`,
);
await db.exec(migration);
await db.exec(migration);
console.log("PASS additive migration reapplies");
const as = async (u) => db.exec(`reset role;set test.uid='${u}';set role authenticated;`);
const rejects = async (sql, part) => {
  await assert.rejects(() => db.query(sql), new RegExp(part));
};
await as(A);
assert.equal((await db.query(`select cargoiq_load_dd_draft('${C}') x`)).rows[0].x.revision, 0);
console.log("PASS empty revision");
assert.equal(
  (await db.query(`select cargoiq_save_dd_draft('${C}',0,'{"containerNo":"SYNTHETIC QA"}') x`))
    .rows[0].x.revision,
  1,
);
assert.equal(
  (await db.query(`select cargoiq_load_dd_draft('${C}') x`)).rows[0].x.draft.containerNo,
  "SYNTHETIC QA",
);
console.log("PASS save reload");
await rejects(`select cargoiq_save_dd_draft('${C}',0,'{}')`, "DRAFT_CONFLICT");
console.log("PASS stale update cannot overwrite");
await rejects(`select cargoiq_save_dd_draft('${C}',1,'[]')`, "INVALID_DRAFT");
console.log("PASS invalid JSON rejected");
await as(B);
await rejects(`select cargoiq_load_dd_draft('${C}')`, "CASE_NOT_FOUND");
await rejects(`select cargoiq_save_dd_draft('${C}',1,'{}')`, "CASE_NOT_FOUND_OR_READ_ONLY");
console.log("PASS other tenant cannot load or save");
await as(V);
assert.equal((await db.query(`select cargoiq_load_dd_draft('${C}') x`)).rows[0].x.revision, 1);
await rejects(`select cargoiq_save_dd_draft('${C}',1,'{}')`, "CASE_NOT_FOUND_OR_READ_ONLY");
console.log("PASS viewer reads but cannot save");
await db.exec("reset role;set role anon");
await rejects(`select cargoiq_load_dd_draft('${C}')`, "permission denied");
await rejects(`select cargoiq_save_dd_draft('${C}',1,'{}')`, "permission denied");
console.log("PASS anonymous functions denied");
await db.close();
