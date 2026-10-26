// ISOLATED synthetic PostgreSQL-compatible proof only. No external connections.
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
if (process.env.MODEL_LIVE_STAGING_DEFAULT_ACL === "1") {
  // Exact read-only observed staging defaults, harness-only. Not new hosted grants.
  await db.exec(`alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
 alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
 grant usage on schema public,auth to authenticated,anon,service_role;`);
}
for (const dir of ["drizzle/migrations", "supabase/migrations"])
  for (const f of fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(fs.readFileSync(path.join(dir, f), "utf8"));
for (const f of [
  "feature_atomic_audit.sql",
  "recovery_comparison_batch.sql",
  "feature_readiness.sql",
]) {
  if (fs.existsSync("docs/proposals/" + f))
    await db.exec(fs.readFileSync("docs/proposals/" + f, "utf8"));
}
const fixtureFingerprint =
  process.env.MODEL_LIVE_STAGING_DEFAULT_ACL === "1"
    ? "fa81f1f6a140130fe0322cec5e295f0d"
    : "026e8afa51cdf2b5e758f08ead4d8c7e";
const proposal = fs
  .readFileSync("docs/proposals/integrated_pack_source.sql", "utf8")
  .replaceAll("026e8afa51cdf2b5e758f08ead4d8c7e", fixtureFingerprint);
const readiness = fs.readFileSync("docs/proposals/feature_readiness.sql", "utf8");
const query = readiness
  .slice(
    readiness.indexOf("select md5(catalog::text)"),
    readiness.indexOf("  return jsonb_build_object"),
  )
  .replace(" into fingerprint", "");
await db.exec("set search_path=''");
console.log("BASELINE_FINGERPRINT", JSON.stringify((await db.query(query)).rows));
await db.exec("set search_path=public");
const A = "11111111-1111-1111-1111-111111111111",
  B = "22222222-2222-2222-2222-222222222222",
  U = "a0000000-0000-0000-0000-000000000001",
  C = "c0000000-0000-0000-0000-000000000001",
  D = "c0000000-0000-0000-0000-000000000002";
await db.exec(
  `insert into auth.users values ('${U}'); insert into tenants(id,name) values ('${A}','SYNTHETIC A'),('${B}','SYNTHETIC B'); insert into user_roles(user_id,tenant_id,role) values ('${U}','${A}','investigator'); insert into cases(id,tenant_id,reference_no) values ('${C}','${A}','SYNTH-A'),('${D}','${B}','SYNTH-B'); set app.uid='${U}';`,
);
await db.exec("set search_path=''");
console.log(
  "PACK_BASE_HASHES",
  JSON.stringify(
    (
      await db.query(
        "select md5(pg_get_functiondef('public.current_pack_source(uuid)'::regprocedure)) s,md5(pg_get_functiondef('public.persist_evidence_pack_atomic(uuid,text)'::regprocedure)) p",
      )
    ).rows,
  ),
);
// Legacy same-tenant reassignment was allowed before this proposal. Keep its
// before/after audit as an adversarial historical fixture.
const M = "c0000000-0000-0000-0000-000000000003";
const H = "f0000000-0000-0000-0000-000000000003";
await db.exec(`insert into public.cases(id,tenant_id,reference_no) values ('${M}','${A}','SYNTH-MOVED');
insert into public.geospatial_findings(id,tenant_id,case_id,title,source,method,created_by) values ('${H}','${A}','${M}','PRIVATE_PRIOR_CASE','fixture','manual','${U}');
update public.geospatial_findings set case_id='${C}',title='Reviewed current case' where id='${H}';`);
await db.exec("set role authenticated");
await assert.rejects(() => db.exec(proposal), /DATABASE_SCHEMA_OWNER_REQUIRED/);
await db.exec("rollback; reset role");
console.log("PASS authenticated app role cannot apply schema proposal");
const probe = proposal.slice(0, proposal.lastIndexOf("DO $$ declare fingerprint"));
await db.exec(probe);
const updatedReadiness = proposal.slice(
  proposal.indexOf("create or replace function public.cargoiq_integrated_feature_readiness()"),
);
const candidateQuery = updatedReadiness
  .slice(
    updatedReadiness.indexOf("select md5(catalog::text)"),
    updatedReadiness.indexOf("  return jsonb_build_object"),
  )
  .replace(" into fingerprint", "");
console.log("FULL_CANDIDATE", JSON.stringify((await db.query(candidateQuery)).rows));
if (process.env.SYNTHETIC_FULL_CATALOG_PATH)
  fs.writeFileSync(
    process.env.SYNTHETIC_FULL_CATALOG_PATH,
    JSON.stringify(
      (await db.query(candidateQuery.replace("md5(catalog::text)", "catalog"))).rows[0].catalog,
    ),
  );
await db.exec("rollback");
await assert.rejects(
  () => db.exec(proposal.replaceAll(fixtureFingerprint, "00000000000000000000000000000000")),
  /FINAL_FEATURE_READINESS_MISMATCH/,
);
await db.exec("rollback");
assert.equal(
  (
    await db.query(
      "select count(*)::int n from pg_trigger where tgname='a0_integrated_pack_source_lock'",
    )
  ).rows[0].n,
  0,
);
assert.equal(
  (
    await db.query(
      "select (public.cargoiq_integrated_feature_readiness()->>'ready')::boolean ready",
    )
  ).rows[0].ready,
  true,
);
console.log(
  "PASS final fingerprint mismatch rolls back all13locks/functions; baseline readiness stays true",
);
await db.exec("set app.uid=''");
try {
  await db.exec(proposal);
} catch (e) {
  console.error("PROPOSAL_ERROR", e.message);
  await db.exec("rollback");
  process.exit(1);
}
await db.exec(`set app.uid='${U}'`);
if (process.env.SYNTHETIC_FUNCTION_CATALOG_PATH) {
  const rows = (
    await db.query(
      "select p.proname,p.prosrc,p.prosecdef,p.provolatile,p.proconfig,p.prorettype::regtype::text result_type,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('current_pack_source','persist_evidence_pack_atomic','cargoiq_integrated_feature_readiness','lock_integrated_pack_source','guard_integrated_pack_write') order by p.proname",
    )
  ).rows;
  fs.writeFileSync(process.env.SYNTHETIC_FUNCTION_CATALOG_PATH, JSON.stringify(rows));
}
console.log(
  "PASS full proposal transaction as schema administrator without spoofed app identity; authenticated readiness true",
);
const source = await db.query(
  `select public.current_pack_source('c0000000-0000-0000-0000-000000000001') source`,
);
assert.equal(source.rows[0].source.integratedFeaturesVersion, "1");
assert.equal(source.rows[0].source.geospatialFindings.length, 1);
assert.equal(source.rows[0].source.geospatialFindingEvents.length, 0);
assert.ok(!JSON.stringify(source.rows[0].source).includes("PRIVATE_PRIOR_CASE"));
console.log("PASS legacy moved-case before/after audit withheld without prior-case text");
const triggers = await db.query(
  `select count(*)::int n from pg_trigger where tgname='a0_integrated_pack_source_lock'`,
);
assert.equal(triggers.rows[0].n, 13);
console.log("PASS exact canonical source keys and13source-lock triggers installed on isolated DB");
// Syntax/serialization check only of outer assertion blocks in the local engine.
// Expected mismatch is correct because hosted owners/defaultACL differ.
if (process.env.OUTER_ASSERT_SYNTAX_FILE) {
  const outerSql = fs.readFileSync(process.env.OUTER_ASSERT_SYNTAX_FILE, "utf8");
  const a = outerSql.indexOf("DO $outer$");
  const b = outerSql.indexOf("end $outer$;", a) + "end $outer$;".length;
  await assert.rejects(() => db.exec(outerSql.slice(a, b)), /OUTER_BASELINE_DRIFT/);
  console.log("PASS outer catalog assertion parses and fails closed on local vs hosted drift");
}
// Report candidate fingerprint for independent review. Not a production approval.
await db.exec("set search_path=''");
console.log("CANDIDATE_FINGERPRINT", JSON.stringify((await db.query(query)).rows));
await db.exec("set search_path=public");
const F = "f0000000-0000-0000-0000-000000000001";
await db.exec(
  `insert into geospatial_findings(id,tenant_id,case_id,title,source,method,created_by) values ('${F}','${A}','${C}','SYNTHETIC finding','fixture only','manual','${U}')`,
);
await db.exec(
  `insert into simulation_scenarios(tenant_id,name,scenario_type,evidence_refs,created_by) values ('${A}','SYNTHETIC explicitly linked','other','[{"kind":"case","id":"${C}"}]','${U}'),('${A}','SYNTHETIC unrelated same port','other','[]','${U}')`,
);
await assert.rejects(
  () =>
    db.exec(
      `insert into simulation_scenarios(tenant_id,name,scenario_type,evidence_refs,created_by) values ('${A}','SYNTHETIC forbidden binding','other','[{"kind":"case","id":"${D}"}]','${U}')`,
    ),
  /SCENARIO_CASE_NOT_IN_WORKSPACE/,
);
// Same-tenant legacy references must not leak through a case-only pack.
const E = "e0000000-0000-0000-0000-000000000007",
  R = "e0000000-0000-0000-0000-000000000008";
await db.exec(`insert into risk_events(id,tenant_id,source,kind,title,observed_at,dedupe_key) values ('${E}','${A}','fixture','other','OTHER_CASE_EVENT','2026-10-26','synthetic-other');
insert into risk_alerts(id,tenant_id,event_id,case_id,headline,risk_explanation,evidence_summary) values ('${R}','${A}','${E}','${M}','OTHER_CASE_ALERT','fixture','fixture');
insert into cost_recovery_links(tenant_id,case_id,event_id,cost_category,notes) values ('${A}','${C}','${E}','other','PRIVATE_EVENT_LINK');
insert into cost_recovery_links(tenant_id,case_id,alert_id,cost_category,notes) values ('${A}','${C}','${R}','other','PRIVATE_ALERT_LINK');
insert into simulation_scenarios(tenant_id,name,scenario_type,evidence_refs,scenario_metrics,created_by) values ('${A}','SYNTHETIC legacy refs','other','["${E}",{"kind":"case","id":"${C}","unknown_private":"${E}"},{"kind":"risk_event","id":"${E}"}]','{"private":"${E}","exposedCaseIds":["${M}"],"scopedEventIds":["${E}"]}','${U}');`);
await db.exec(
  `update simulation_scenarios set baseline_metrics=jsonb_build_object('caseScopeVersion','1','caseIds',jsonb_build_array('${C}'),'foreign_machine_array',jsonb_build_array('${M}')) where name='SYNTHETIC legacy refs'`,
);
const snapshot = (await db.query(`select current_pack_source('${C}') p`)).rows[0].p;
assert.equal(snapshot.geospatialFindings.length, 2);
assert.equal(snapshot.geospatialFindingEvents.length, 1);
assert.equal(snapshot.simulationScenarios.length, 2);
assert.equal(snapshot.costRecoveryLinks.length, 0);
assert.deepEqual(snapshot.simulationCaseComparison.linkedEventIds, []);
assert.equal(snapshot.simulationCaseComparison.recordedLinkedEvents, 0);
assert.equal(snapshot.simulationCaseComparison.scenarioImpact, "insufficient_data");
for (const secret of [E, R, "PRIVATE_EVENT_LINK", "PRIVATE_ALERT_LINK"])
  assert.ok(!JSON.stringify(snapshot).includes(secret));
console.log("PASS no unrelated event/alert IDs or notes anywhere in case source or audit");
// Positive baseline: only a genuine explicit link contributes, deduped across
// link rationale rows. Stored scenario scope markers cannot add foreign events.
const GOOD = "e0000000-0000-0000-0000-000000000009";
await db.exec(`insert into risk_events(id,tenant_id,source,kind,title,observed_at,dedupe_key,verification_status) values ('${GOOD}','${A}','fixture','other','SYNTHETIC explicitly linked event','2026-10-26','synthetic-good','confirmed');
insert into risk_event_case_links(tenant_id,event_id,case_id,match_basis,rationale) values ('${A}','${GOOD}','${C}','manual','SYNTHETIC explicit link'),('${A}','${GOOD}','${C}','port','SYNTHETIC additional rationale');`);
const linkedSource = (await db.query(`select current_pack_source('${C}') p`)).rows[0].p;
assert.deepEqual(linkedSource.simulationCaseComparison.linkedEventIds, [GOOD]);
assert.equal(linkedSource.simulationCaseComparison.recordedLinkedEvents, 1);
assert.equal(linkedSource.simulationCaseComparison.confirmedLinkedEvents, 1);
assert.ok(!JSON.stringify(linkedSource).includes(E));
console.log(
  "PASS canonical comparison counts one explicitly linked event once, rejects unrelated event despite stored markers",
);
// Remove positive fixture within isolated engine so existing frozen persistence
// assertions keep comparing the original snapshot. No external database access.
await db.exec(
  `delete from risk_event_case_links where event_id='${GOOD}'; delete from risk_events where id='${GOOD}';`,
);

if (process.env.SYNTHETIC_SNAPSHOT_PATH)
  fs.writeFileSync(process.env.SYNTHETIC_SNAPSHOT_PATH, JSON.stringify(snapshot));
assert.equal(snapshot.simulationScenarioEvents.length, 3);
// Harness only: Supabase normally provides auth schema usage and public schema
// usage. No table privileges are widened here; migrations own their grants/RLS.
await db.exec("grant usage on schema auth,public to authenticated; set role authenticated");
// REST-equivalent direct row writes must obey the same source/canonical gate.
await assert.rejects(
  () =>
    db.exec(
      `insert into evidence_packs(tenant_id,case_id,version,pack_payload,sha256_hash,status) values ('${A}','${C}',1,'{}','invented','DRAFT')`,
    ),
  /NEW_PACK_CANONICAL_REQUIRED/,
);
if (process.env.MODEL_LIVE_STAGING_DEFAULT_ACL !== "1") await db.exec("reset role");
const forged = JSON.stringify({
  version: 1,
  generatedAt: new Date().toISOString(),
  case: { id: C },
  invented: "PRIVATE_FORGERY",
});
await assert.rejects(
  () =>
    db.query(
      `insert into evidence_packs(tenant_id,case_id,version,pack_payload,canonical_payload,sha256_hash,status) values ($1,$2,1,$3::jsonb,$3::text,encode(sha256(convert_to($3::text,'UTF8')),'hex'),'DRAFT')`,
      [A, C, forged],
    ),
  /Case evidence changed/,
);
console.log(
  process.env.MODEL_LIVE_STAGING_DEFAULT_ACL === "1"
    ? "PASS modeled-live-defaultACL actual authenticated forged INSERT refusal and canonical generation path"
    : "PASS actual authenticated NULL canonical refusal; schema-owner forged source refusal, ordinary harness lacks source SELECT grants",
);
// Offline reproduction of actual postgres.js direct-INSERT serialization bug.
// Sending a canonical STRING as a JSONB parameter double-encodes the payload.
const { types: driverTypes } = await import("../node_modules/postgres/src/types.js");
const probeCanonical = JSON.stringify({
  ...snapshot,
  version: 1,
  generatedAt: new Date().toISOString(),
});
const doubleEncoded = driverTypes.json.serialize(probeCanonical);
await assert.rejects(
  () =>
    db.query(
      `insert into evidence_packs(tenant_id,case_id,version,pack_payload,canonical_payload,sha256_hash,status) values ($1,$2,1,$3::jsonb,$4::text,encode(sha256(convert_to($4::text,'UTF8')),'hex'),'DRAFT')`,
      [A, C, doubleEncoded, probeCanonical],
    ),
  /EVIDENCE_PACK_HASH_MISMATCH/,
);
console.log(
  "PASS reproduces hosted negative-test failure from driver double-encoded JSONB string, not canonical RPC corruption",
);
if (process.env.MODEL_LIVE_STAGING_DEFAULT_ACL === "1") {
  await db.exec("reset role");
  const V = "a0000000-0000-0000-0000-000000000002";
  await db.exec(
    `insert into auth.users values ('${V}'); insert into user_roles(user_id,tenant_id,role) values ('${V}','${A}','viewer'); set role authenticated; set app.uid='${V}'`,
  );
  await assert.rejects(
    () =>
      db.query(
        `insert into evidence_packs(tenant_id,case_id,version,pack_payload,canonical_payload,sha256_hash,status) values ($1,$2,1,$3::text::jsonb,$3::text,encode(sha256(convert_to($3::text,'UTF8')),'hex'),'DRAFT')`,
        [A, C, probeCanonical],
      ),
    (e) => e.code === "42501" || /Investigator access required/.test(e.message),
  );
  await db.exec(`set app.uid='${U}'`);
  await assert.rejects(
    () =>
      db.query(
        `insert into evidence_packs(tenant_id,case_id,version,pack_payload,canonical_payload,sha256_hash,status) values ($1,$2,1,$3::text::jsonb,$3::text,encode(sha256(convert_to($3::text,'UTF8')),'hex'),'APPROVED')`,
        [A, C, probeCanonical],
      ),
    /Generate a draft before approval/,
  );
  console.log(
    "PASS corrected TEXT-to-JSONB valid canonical fixture reaches viewer role refusal and direct APPROVED refusal",
  );
}
if (process.env.MODEL_LIVE_STAGING_DEFAULT_ACL !== "1") await db.exec("reset role");
const canonical = JSON.stringify({
  ...snapshot,
  generatedAt: new Date().toISOString(),
  version: 1,
});
const pack = (await db.query(`select * from persist_evidence_pack_atomic($1,$2)`, [C, canonical]))
  .rows[0];
assert.equal(pack.pack_payload.geospatialFindings[0].id, F);
assert.equal(pack.canonical_payload, canonical);
await db.exec(`update geospatial_findings set title='SYNTHETIC later revision' where id='${F}'`);
const old = (await db.query(`select pack_payload from evidence_packs where id=$1`, [pack.id]))
  .rows[0];
assert.equal(old.pack_payload.geospatialFindings[0].title, "SYNTHETIC finding");
const stale = JSON.stringify({ ...snapshot, generatedAt: new Date().toISOString(), version: 2 });
await assert.rejects(
  () => db.query(`select persist_evidence_pack_atomic($1,$2)`, [C, stale]),
  /Case evidence changed/,
);
assert.equal(
  (
    await db.query(
      `select count(*)::int n from audit_log where case_id='${C}' and action='EVIDENCE_PACK_GENERATED'`,
    )
  ).rows[0].n,
  1,
);
const persistedHash = (
  await db.query(
    `select encode(sha256(convert_to(canonical_payload,'UTF8')),'hex')=sha256_hash ok from evidence_packs where id=$1`,
    [pack.id],
  )
).rows[0].ok;
assert.equal(persistedHash, true);
await db.exec("reset role");
await assert.rejects(() => db.exec(proposal), /BASELINE_FEATURE_CATALOG_MISMATCH/);
await db.exec("rollback");
assert.equal(
  (
    await db.query(
      "select (public.cargoiq_integrated_feature_readiness()->>'ready')::boolean ready",
    )
  ).rows[0].ready,
  true,
);
console.log(
  "PASS repeat apply refuses and rolls back without deactivating routes; stored pack hash and atomic generation audit match",
);
console.log(
  "PASS explicit simulation binding, foreign case refusal, entity+audit frozen, canonical byte/hash persistence, immutable old pack and stale-source refusal",
);
await db.close();
