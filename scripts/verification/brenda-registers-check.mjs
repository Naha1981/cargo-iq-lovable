const { PGlite } = await import(process.env.CARGOIQ_PGLITE_MODULE ?? "@electric-sql/pglite");
import fs from "node:fs";
import assert from "node:assert/strict";
const db = new PGlite(),
  root = process.cwd();
await db.exec(
  `CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;GRANT USAGE ON SCHEMA auth TO authenticated;`,
);
await db.exec(fs.readFileSync(root + "/drizzle/migrations/0000_cargoiq_core.sql", "utf8"));
await db.exec(
  fs
    .readdirSync(root + "/supabase/migrations")
    .filter((n) => /^202610151(410|430|450|510|530|550|630|650|710)00_/.test(n))
    .sort()
    .map((n) => fs.readFileSync(root + "/supabase/migrations/" + n, "utf8"))
    .join("\n"),
);
await db.exec(
  `CREATE SCHEMA storage;CREATE TABLE storage.objects(id uuid,bucket_id text,name text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;`,
);
for (const f of [
  "20261016061500_seed_financial_gate_compatibility.sql",
  "20261016062500_atomic_evidence_packs.sql",
  "20261016063000_core_viewer_readonly_guard.sql",
  "20261016110500_count_ledger.sql",
  "20261016111000_appointment_lifecycle.sql",
  "20261016111500_authorised_exports.sql",
  "20261016112000_count_comparisons.sql",
  "20261016112500_extended_pack_sources.sql",
  "20261016113000_register_guard_followup.sql",
]) {
  await db.exec(fs.readFileSync(root + "/supabase/migrations/" + f, "utf8"));
  console.log("PASS applied", f);
}
await db.exec(
  fs.readFileSync(root + "/supabase/migrations/20261016113000_register_guard_followup.sql", "utf8"),
);
console.log("PASS idempotent SQL guard follow-up");
const u = [
  "10000000-0000-4000-8000-000000000001",
  "10000000-0000-4000-8000-000000000002",
  "10000000-0000-4000-8000-000000000003",
];
await db.query("INSERT INTO auth.users VALUES($1),($2),($3)", u);
await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [u[0]]);
const t = (await db.query("SELECT provision_organization('SYNTHETIC count tests') AS id")).rows[0]
  .id;
const t2 = (await db.query("INSERT INTO tenants(name) VALUES('SYNTHETIC foreign') RETURNING id"))
  .rows[0].id;
await db.query(
  "INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$2,'viewer'),($3,$4,'admin')",
  [u[1], t, u[2], t2],
);
const c = (
  await db.query(
    "INSERT INTO cases(tenant_id,reference_no,title) VALUES($1,'SYN-COUNT','SYNTHETIC count case') RETURNING id",
    [t],
  )
).rows[0].id;
const doc = (
  await db.query(
    "INSERT INTO documents(tenant_id,case_id,name,file_path,file_type,sha256_hash,source_party) VALUES($1,$2,'SYNTHETIC source','synthetic','text/plain','synthetic-hash','Synthetic terminal') RETURNING id",
    [t, c],
  )
).rows[0].id;
async function as(id) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("SET ROLE authenticated");
}
async function denied(fn, label) {
  let e;
  try {
    await fn();
  } catch (x) {
    e = x;
  }
  assert.ok(e, label);
  console.log("PASS denied", label, e.message);
}
const sql = `INSERT INTO count_source_records(tenant_id,case_id,physical_reference,party,metric,basis,quantity,occurred_at,gate_kind,source_document_id,source_reference,limitations,supersedes_id) VALUES($1,$2,'HATCH-001','Synthetic terminal','HATCH_COVER','INDIVIDUAL_LIFT',4,'2026-10-16T10:00:00Z','NOT_APPLICABLE',$3,'row1','SYNTHETIC evidence only',$4) RETURNING *`;
await as(u[0]);
let row = (await db.query(sql, [t, c, doc, null])).rows[0];
assert.equal(row.version, 1);
assert.equal(row.created_by, u[0]);
console.log("PASS investigator append + actor stamp + version");
await denied(() => db.query(sql, [t, c, doc, null]), "stale first version");
const two = (await db.query(sql, [t, c, doc, row.id])).rows[0];
assert.equal(two.version, 2);
await denied(
  () => db.query("UPDATE count_source_records SET quantity=5 WHERE id=$1", [row.id]),
  "immutable source",
);
await as(u[1]);
await denied(() => db.query(sql, [t, c, doc, two.id]), "viewer append");
await as(u[2]);
assert.equal((await db.query("SELECT * FROM count_source_records")).rows.length, 0);
await denied(() => db.query(sql, [t2, c, doc, null]), "foreign case and source");
await as(u[0]);
assert.equal(
  (await db.query("SELECT count(*)::int n FROM audit_log WHERE action='COUNT_REGISTER_APPENDED'"))
    .rows[0].n,
  2,
);
await db.exec("RESET ROLE");
await db.exec(
  `CREATE FUNCTION fail_count_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='COUNT_REGISTER_APPENDED' THEN RAISE EXCEPTION 'synthetic audit rejection';END IF;RETURN NEW;END$$;CREATE TRIGGER count_audit_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_count_audit();`,
);
await as(u[0]);
await denied(() => db.query(sql, [t, c, doc, two.id]), "audit failure");
assert.equal((await db.query("SELECT count(*)::int n FROM count_source_records")).rows[0].n, 2);
console.log("PASS audit failure rolls back count source");
await db.exec("RESET ROLE");
await db.exec("DROP TRIGGER count_audit_failure ON audit_log");
await as(u[0]);
const appointmentSql = `INSERT INTO appointment_lifecycle(tenant_id,case_id,appointment_reference,physical_reference,record_type,issuer,party,start_at,end_at,occurred_at,claim_target,outcome,explanation,terms_reference,source_document_id,source_reference,supersedes_id) VALUES($1,$2,'TBS-001','VISIT-001','SLOT','Shipping line','Synthetic terminal','2026-10-16T08:00:00Z','2026-10-16T09:00:00Z','2026-10-15T10:00:00Z','','NOT_ASSESSED','Synthetic slot record','Synthetic terms p1',$3,'row1',$4) RETURNING *`;
const slot = (await db.query(appointmentSql, [t, c, doc, null])).rows[0];
const revision = (await db.query(appointmentSql, [t, c, doc, slot.id])).rows[0];
assert.equal(revision.version, 2);
await denied(() => db.query(appointmentSql, [t, c, doc, slot.id]), "stale lifecycle correction");
await as(u[1]);
await denied(() => db.query(appointmentSql, [t, c, doc, null]), "viewer lifecycle");
await as(u[2]);
assert.equal((await db.query("SELECT * FROM appointment_lifecycle")).rows.length, 0);
console.log("PASS appointment history, role isolation, stale correction");
await as(u[0]);
const csv =
  "physicalReference,metric,basis,quantity,occurredAt,containers20,containers40,gateKind,sourceReference,limitations\nHATCH-002,HATCH_COVER,INDIVIDUAL_LIFT,4,2026-10-16T10:00:00Z,,,NOT_APPLICABLE,row1,SYNTHETIC evidence only";
const mapped = [
  {
    caseId: c,
    sourceDocumentId: doc,
    party: "Synthetic terminal",
    supersedesId: null,
    physicalReference: "HATCH-002",
    metric: "HATCH_COVER",
    basis: "INDIVIDUAL_LIFT",
    quantity: 4,
    occurredAt: "2026-10-16T10:00:00Z",
    containers20: null,
    containers40: null,
    gateKind: "NOT_APPLICABLE",
    sourceReference: "row1",
    limitations: "SYNTHETIC evidence only",
  },
];
const impSql = "SELECT ingest_authorised_export($1,$2,$3,$4,$5,$6,$7,$8) AS result";
const args = [
  c,
  doc,
  "Synthetic terminal",
  "COUNTS",
  "Synthetic export permission for test only",
  "2026-10-16T10:00:00Z",
  csv,
  JSON.stringify(mapped),
];
const imported = (await db.query(impSql, args)).rows[0].result;
assert.equal(imported.row_count, 1);
assert.equal(imported.raw_sha256.length, 64);
await denied(() => db.query(impSql, args), "duplicate export");
await denied(
  () =>
    db.query(impSql, [
      ...args.slice(0, 6),
      csv.replace("HATCH-002", "HATCH-003"),
      JSON.stringify([{ ...mapped[0], physicalReference: "HATCH-003", quantity: 99 }]),
    ]),
  "raw CSV mapping tampering",
);
await denied(
  () =>
    db.query(impSql, [
      ...args.slice(0, 6),
      csv.replace("HATCH-002", "HATCH-001"),
      JSON.stringify([{ ...mapped[0], physicalReference: "HATCH-001" }]),
    ]),
  "import conflicts with existing source version",
);
assert.equal((await db.query("SELECT count(*)::int n FROM authorised_imports")).rows[0].n, 1);
await as(u[1]);
await denied(() => db.query(impSql, args), "viewer import");
await as(u[2]);
assert.equal((await db.query("SELECT * FROM authorised_imports")).rows.length, 0);
console.log("PASS import atomicity, raw mapping, idempotency, tenant and role protection");
await as(u[0]);
const pack = (await db.query("SELECT current_pack_source($1) AS p", [c])).rows[0].p;
assert.equal(pack.countSourceRecords.length, 3);
assert.equal(pack.authorisedImports.length, 1);
assert.equal(pack.appointmentLifecycle.length, 2);
assert.equal(pack.countEngineVersion, "1");
console.log("PASS extended atomic source includes all new registers");
const ruleSql =
  "INSERT INTO count_rule_versions(tenant_id,case_id,name,metric,input_basis,output_unit,calculation,numerator,denominator,acceptance,effective_from,source_document_id,source_reference,rationale) VALUES($1,$2,'Synthetic lifts','HATCH_COVER','INDIVIDUAL_LIFT','operation','EXPLICIT_FACTOR',1,4,'AGREED','2026-10-01T00:00:00Z',$3,'p.1','SYNTHETIC agreed mapping only') RETURNING id";
const ruleId = (await db.query(ruleSql, [t, c, doc])).rows[0].id;
const compSql =
  "INSERT INTO count_comparison_definitions(tenant_id,case_id,name,metric,output_unit,rule_ids,physical_references,acceptance,rationale,source_document_id,source_reference,supersedes_id) VALUES($1,$2,'Synthetic common scope','HATCH_COVER','operation',ARRAY[$3::uuid],ARRAY['HATCH-001'],'AGREED','SYNTHETIC physical identity and mapping agreement',$4,'p.1',$5) RETURNING *";
const comp = (await db.query(compSql, [t, c, ruleId, doc, null])).rows[0];
assert.equal(comp.version, 1);
await denied(() => db.query(compSql, [t, c, ruleId, doc, null]), "stale comparison append");
await as(u[1]);
await denied(() => db.query(compSql, [t, c, ruleId, doc, comp.id]), "viewer comparison append");
await as(u[2]);
assert.equal((await db.query("SELECT * FROM count_comparison_definitions")).rows.length, 0);
await as(u[0]);
const canon = (v) =>
  v === null || typeof v !== "object"
    ? JSON.stringify(v)
    : Array.isArray(v)
      ? "[" + v.map(canon).join(",") + "]"
      : "{" +
        Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canon(v[k]))
          .join(",") +
        "}";
let fresh = (await db.query("SELECT current_pack_source($1) p", [c])).rows[0].p;
const pack1 = (
  await db.query("SELECT * FROM persist_evidence_pack_atomic($1,$2)", [
    c,
    canon({ ...fresh, version: 1, generatedAt: new Date().toISOString() }),
  ])
).rows[0];
assert.ok(pack1.id);
const stale = { ...fresh, version: 2, generatedAt: new Date().toISOString() };
await db.query(compSql, [t, c, ruleId, doc, comp.id]);
await denied(
  () => db.query("SELECT * FROM persist_evidence_pack_atomic($1,$2)", [c, canon(stale)]),
  "new comparison invalidates stale frozen snapshot",
);
console.log("PASS common-unit SQL role/version guards and extended atomic persistence freshness");
await db.close();
