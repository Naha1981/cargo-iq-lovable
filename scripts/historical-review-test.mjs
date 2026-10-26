// Isolated synthetic PostgreSQL proof. No external connections.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
const db = await PGlite.create();
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create table auth.users(id uuid primary key default gen_random_uuid());
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
create schema storage; create table storage.buckets(id text primary key,name text,public boolean);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid);
create function storage.foldername(n text) returns text[] language sql immutable as $$select string_to_array(n,'/')$$;`);
for (const dir of ["drizzle/migrations", "supabase/migrations"])
  for (const f of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
await db.exec(fs.readFileSync("docs/proposals/historical_record_review.sql", "utf8"));
const readinessSql = fs.readFileSync("docs/proposals/historical_record_review.sql", "utf8");
const fingerprintSql = readinessSql.slice(
  readinessSql.indexOf(" select md5(") + 1,
  readinessSql.indexOf(" INTO fingerprint;"),
);
await db.exec("set search_path=''");
console.log("HISTORICAL_LOCAL_FINGERPRINT", JSON.stringify((await db.query(fingerprintSql)).rows));
await db.exec("set search_path=public");
const A = "11111111-1111-1111-1111-111111111111",
  B = "22222222-2222-2222-2222-222222222222",
  U = "a0000000-0000-0000-0000-000000000001",
  V = "a0000000-0000-0000-0000-000000000002",
  C = "c0000000-0000-0000-0000-000000000001",
  D = "c0000000-0000-0000-0000-000000000002",
  E = "c0000000-0000-0000-0000-000000000003",
  R = "f0000000-0000-0000-0000-000000000001";
await db.exec(`insert into auth.users values('${U}'),('${V}'); insert into tenants(id,name) values('${A}','SYNTH-A'),('${B}','SYNTH-B'); insert into user_roles(user_id,tenant_id,role) values('${U}','${A}','investigator'),('${V}','${A}','viewer'); insert into cases(id,tenant_id,reference_no) values('${C}','${A}','SYNTH-C'),('${D}','${B}','SYNTH-D'),('${E}','${A}','SYNTH-E');
insert into timeline_events(tenant_id,case_id,timestamp,title,coordinates) values
('${A}','${C}','2025-12-02T23:00:00Z','SAST matching source','{"lat":-29.856,"lon":31.041}'),
('${A}','${C}','2025-12-04T10:00:00Z','WRONG-DAY','{"lat":-29.856,"lon":31.041}'),
('${A}','${C}','2025-12-03T10:00:00Z','MALFORMED','{"lat":"NaN","lon":31.041}'),
('${A}','${C}','2025-12-03T10:00:00Z','FAR','{"lat":0,"lon":31.041}'),
('${A}','${E}','2025-12-03T10:00:00Z','OTHER-CASE-PRIVATE','{"lat":-29.856,"lon":31.041}'),
('${B}','${D}','2025-12-03T10:00:00Z','OTHER-TENANT-PRIVATE','{"lat":-29.856,"lon":31.041}');
grant usage on schema public,auth to authenticated,anon; set role authenticated; set app.uid='${V}';`);
const call = (caseId = C, request = R, date = "2025-12-03", confirmed = true) =>
  db.query(
    `select save_historical_record_review($1::uuid,$2::uuid,$3::date,$4,$5::float8,$6::float8,$7::boolean) result`,
    [caseId, request, date, "Candidate reference", -29.856, 31.041, confirmed],
  );
await assert.rejects(() => call(), /INVESTIGATOR_REQUIRED/);
await db.exec(`set app.uid='${U}'`);
await assert.rejects(() => call(D), /INVESTIGATOR_REQUIRED/);
await assert.rejects(() => call(C, R, "2025-12-03", false), /REVIEW_CONFIRMATION_REQUIRED/);
await assert.rejects(() => call(C, R, "2025-02-31"), /date/);
assert.equal(
  (await db.query("select cargoiq_historical_review_readiness() r")).rows[0].r.ready,
  true,
);
await db.exec(
  "reset role; alter table external_observations disable trigger historical_review_audit; set role authenticated",
);
assert.equal(
  (await db.query("select cargoiq_historical_review_readiness() r")).rows[0].r.ready,
  false,
);
await db.exec(
  "reset role; alter table external_observations enable trigger historical_review_audit; set role authenticated",
);
const result = (await call()).rows[0].result;
assert.equal(result.recordCount, 1);
const same = (await call()).rows[0].result;
assert.deepEqual(same, result);
const rows = (await db.query(`select * from external_observations where id=$1`, [R])).rows;
assert.equal(rows.length, 1);
assert.equal(rows[0].confidence, null);
assert.equal(rows[0].latitude, null);
assert.equal(rows[0].payload.records[0].title, "SAST matching source");
assert.equal(rows[0].payload.basemapIsHistorical, false);
assert.equal(rows[0].payload.terminalIdentityVerified, false);
assert.equal(
  (await db.query(`select count(*)::int n from audit_log where entity_id=$1`, [R])).rows[0].n,
  1,
);
await assert.rejects(() => call(C, R, "2025-12-04"), /REVIEW_REQUEST_CONFLICT/);
const source = (await db.query("select current_pack_source($1) s", [C])).rows[0].s;
assert.equal(source.externalObservations[0].payload.records.length, 1);
assert.equal(JSON.stringify(source).includes("OTHER-CASE-PRIVATE"), false);
assert.equal(JSON.stringify(source).includes("OTHER-TENANT-PRIVATE"), false);
const canonical = JSON.stringify({ ...source, generatedAt: new Date().toISOString(), version: 1 });
const pack = (await db.query("select * from persist_evidence_pack_atomic($1,$2)", [C, canonical]))
  .rows[0];
assert.equal(pack.canonical_payload, canonical);
assert.equal(
  pack.pack_payload.externalObservations[0].payload.records[0].title,
  "SAST matching source",
);
assert.equal(
  (
    await db.query(
      "select encode(sha256(convert_to(canonical_payload,'UTF8')),'hex')=sha256_hash ok from evidence_packs where id=$1",
      [pack.id],
    )
  ).rows[0].ok,
  true,
);
const snapshot = JSON.stringify(source.externalObservations);
await call(C, "f0000000-0000-0000-0000-000000000002", "2025-12-05");
assert.equal(
  (
    await db.query(
      `select payload->'records' r from external_observations where id='f0000000-0000-0000-0000-000000000002'`,
    )
  ).rows[0].r.length,
  0,
);
assert.equal(JSON.stringify(source.externalObservations), snapshot);
assert.equal(
  JSON.stringify(
    (await db.query("select pack_payload from evidence_packs where id=$1", [pack.id])).rows[0]
      .pack_payload.externalObservations,
  ),
  snapshot,
);
await assert.rejects(
  () =>
    db.query("select persist_evidence_pack_atomic($1,$2)", [
      C,
      JSON.stringify({ ...source, generatedAt: new Date().toISOString(), version: 2 }),
    ]),
  /Case evidence changed/,
);

await assert.rejects(
  () => db.exec(`update external_observations set source='changed' where id='${R}'`),
  /UPDATE_BLOCKED/,
);
// Direct REST-style insertion cannot inject records/actor/confidence or skip audit.
await db.query(
  `insert into external_observations(id,tenant_id,case_id,source,observation_type,observed_at,confidence,payload) values('f0000000-0000-0000-0000-000000000004',$1,$2,'FORGED','HISTORICAL_RECORD_REVIEW',now(),1,$3::jsonb)`,
  [
    A,
    C,
    JSON.stringify({
      selectedDate: "2025-12-03",
      candidatePlace: "Direct candidate",
      referenceLatitude: -29.856,
      referenceLongitude: 31.041,
      confirmed: true,
      records: [{ title: "FORGED PRIVATE" }],
      reviewedBy: V,
    }),
  ],
);
const direct = (
  await db.query(
    `select payload,confidence,source from external_observations where id='f0000000-0000-0000-0000-000000000004'`,
  )
).rows[0];
assert.equal(direct.payload.records[0].title, "SAST matching source");
assert.equal(direct.payload.reviewedBy, U);
assert.equal(direct.confidence, null);
assert.equal(direct.source, "CargoIQ historical record review");
assert.equal(
  (
    await db.query(
      `select count(*)::int n from audit_log where entity_id='f0000000-0000-0000-0000-000000000004'`,
    )
  ).rows[0].n,
  1,
);
await db.exec(
  `reset role; alter table audit_log add constraint synth_audit_failure check (entity_id is distinct from 'f0000000-0000-0000-0000-000000000003'::uuid) not valid; set role authenticated;`,
);
await assert.rejects(
  () => call(C, "f0000000-0000-0000-0000-000000000003", "2025-12-03"),
  /synth_audit_failure/,
);
assert.equal(
  (
    await db.query(
      `select count(*)::int n from external_observations where id='f0000000-0000-0000-0000-000000000003'`,
    )
  ).rows[0].n,
  0,
);
await db.exec("reset role; set role anon");
await assert.rejects(() => call(), /permission denied/);
console.log(
  "PASS historical review: viewer/foreign/anon refusal, SAST date and finite nearby case-only server source, idempotency/conflict, zero-result uncertainty, immutable source, frozen projection and atomic audit rollback",
);
await db.close();
