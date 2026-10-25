const { PGlite } = await import(process.env.CARGOIQ_PGLITE_MODULE ?? "@electric-sql/pglite");
import fs from "node:fs";
import assert from "node:assert/strict";
import crypto from "node:crypto";
const db = new PGlite();
const root = process.cwd();
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
  fs.readFileSync(
    root + "/supabase/migrations/20261016061500_seed_financial_gate_compatibility.sql",
    "utf8",
  ),
);
const uid = "10000000-0000-4000-8000-000000000001",
  viewer = "10000000-0000-4000-8000-000000000002",
  foreign = "10000000-0000-4000-8000-000000000003";
await db.query("INSERT INTO auth.users VALUES($1),($2),($3)", [uid, viewer, foreign]);
await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uid]);
const t = (await db.query("SELECT provision_organization('SYNTHETIC local atomic QA') AS id"))
  .rows[0].id;
const other = (await db.query("INSERT INTO tenants(name) VALUES('SYNTHETIC foreign') RETURNING id"))
  .rows[0].id;
await db.query(
  "INSERT INTO user_roles(user_id,tenant_id,role) VALUES($1,$2,'viewer'),($3,$4,'admin')",
  [viewer, t, foreign, other],
);
const c = (
  await db.query(
    "INSERT INTO cases(tenant_id,reference_no,title) VALUES($1,'SYN-ATOMIC','SYNTHETIC empty clean fixture') RETURNING *",
    [t],
  )
).rows[0];
await db.exec(
  `CREATE SCHEMA storage;CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;GRANT USAGE ON SCHEMA storage TO authenticated;GRANT ALL ON storage.objects TO authenticated;CREATE POLICY member_storage ON storage.objects FOR ALL TO authenticated USING(true) WITH CHECK(true);`,
);
await asPre();
async function asPre() {
  await db.exec("RESET ROLE");
}
await db.exec(
  fs.readFileSync(
    root + "/supabase/migrations/20261016063000_core_viewer_readonly_guard.sql",
    "utf8",
  ),
);
const migration = fs.readFileSync(
  root + "/supabase/migrations/20261016062500_atomic_evidence_packs.sql",
  "utf8",
);
await db.exec(migration);
console.log("PASS migration on full core+nine+seed patch");
let repeated = false;
try {
  await db.exec(migration);
} catch (e) {
  repeated = true;
  await db.exec("ROLLBACK");
}
assert.ok(repeated);
console.log("PASS repeated/partial migration safely refuses");
async function as(u) {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [u]);
  await db.exec("SET ROLE authenticated");
}
async function denied(fn, label, match) {
  let error;
  try {
    await fn();
  } catch (e) {
    error = e;
  }
  assert.ok(error, label);
  if (match) assert.ok(error.message.includes(match), error.message);
  console.log("PASS", label, error.message);
}
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
async function prepare(version) {
  const p = (await db.query("SELECT current_pack_source($1) AS p", [c.id])).rows[0].p;
  return { ...p, version, generatedAt: new Date().toISOString() };
}
async function persist(p) {
  return (await db.query("SELECT * FROM persist_evidence_pack_atomic($1,$2)", [c.id, canon(p)]))
    .rows[0];
}
await as(uid);
const p1 = await persist(await prepare(1));
assert.equal(
  p1.sha256_hash,
  crypto.createHash("sha256").update(p1.canonical_payload).digest("hex"),
);
assert.equal(p1.status, "DRAFT");
console.log("PASS DBcomputed SHA matches exact app canonical UTF8 bytes");
const a1 = (
  await db.query(
    "SELECT * FROM audit_log WHERE entity_id=$1 AND action='EVIDENCE_PACK_GENERATED'",
    [p1.id],
  )
).rows;
assert.equal(a1.length, 1);
console.log("PASS exactly one transactional generation audit");
await denied(
  () => persist({ ...p1.pack_payload, version: 1 }),
  "stale version refused",
  "version changed",
);
assert.equal(
  (await db.query("SELECT status FROM evidence_packs WHERE id=$1", [p1.id])).rows[0].status,
  "DRAFT",
);
let stale = await prepare(2);
await db.query(
  "INSERT INTO timeline_events(tenant_id,case_id,timestamp,title) VALUES($1,$2,now(),'SYNTHETIC new event')",
  [t, c.id],
);
await denied(() => persist(stale), "stale source snapshot refused", "Case evidence changed");
await db.exec("RESET ROLE");
await db.exec(
  `CREATE FUNCTION fail_pack_qa_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action LIKE 'EVIDENCE_PACK_%' THEN RAISE EXCEPTION 'SYNTHETIC_AUDIT_REJECT'; END IF;RETURN NEW;END$$;CREATE TRIGGER qa_fail_pack_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_pack_qa_audit();`,
);
await as(uid);
await denied(
  async () => persist(await prepare(2)),
  "forced audit failure rolls back new pack",
  "SYNTHETIC_AUDIT_REJECT",
);
assert.equal(
  (await db.query("SELECT count(*) AS n FROM evidence_packs WHERE case_id=$1", [c.id])).rows[0].n,
  1,
);
assert.equal(
  (await db.query("SELECT status FROM evidence_packs WHERE id=$1", [p1.id])).rows[0].status,
  "DRAFT",
);
console.log("PASS old draft not superseded on failed generation");
await denied(
  () => db.query("SELECT approve_evidence_pack_atomic($1,$2)", [c.id, p1.id]),
  "forced audit failure rolls back approval",
  "SYNTHETIC_AUDIT_REJECT",
);
assert.equal(
  (await db.query("SELECT status FROM evidence_packs WHERE id=$1", [p1.id])).rows[0].status,
  "DRAFT",
);
assert.equal(
  (await db.query("SELECT status FROM cases WHERE id=$1", [c.id])).rows[0].status,
  "OPEN",
);
await db.exec("RESET ROLE");
await db.exec("DROP TRIGGER qa_fail_pack_audit ON audit_log");
await as(uid);
const p2 = await persist(await prepare(2));
assert.equal(
  (await db.query("SELECT status FROM evidence_packs WHERE id=$1", [p1.id])).rows[0].status,
  "SUPERSEDED",
);
console.log("PASS successful generation atomically supersedes old draft");
await db.query("SELECT approve_evidence_pack_atomic($1,$2)", [c.id, p2.id]);
assert.equal(
  (await db.query("SELECT status FROM cases WHERE id=$1", [c.id])).rows[0].status,
  "APPROVED",
);
assert.equal(
  (await db.query("SELECT approved_by FROM evidence_packs WHERE id=$1", [p2.id])).rows[0]
    .approved_by,
  uid,
);
assert.equal(
  (
    await db.query(
      "SELECT count(*) AS n FROM audit_log WHERE entity_id=$1 AND action='EVIDENCE_PACK_APPROVED'",
      [p2.id],
    )
  ).rows[0].n,
  1,
);
console.log("PASS approval+actor+case+single audit same transaction");
await denied(
  () => db.query("UPDATE evidence_packs SET canonical_payload=$1 WHERE id=$2", ["{}", p2.id]),
  "canonical bytes immutable",
  "IMMUTABLE",
);
const p3 = await persist(await prepare(3));
await as(viewer);
await denied(
  async () => persist(await prepare(4)),
  "viewer generate blocked",
  "Investigator access required",
);
await denied(
  () => db.query("SELECT approve_evidence_pack_atomic($1,$2)", [c.id, p3.id]),
  "viewer approval blocked",
);
await as(foreign);
await denied(
  () =>
    db.query(
      "INSERT INTO financial_calculations(tenant_id,case_id,calculation_type) VALUES($1,$2,'SYNTHETIC_FOREIGN')",
      [other, c.id],
    ),
  "own-tenant money cannot reference foreign case",
  "Case tenant mismatch",
);
await denied(
  () =>
    db.query(
      "INSERT INTO evidence_packs(tenant_id,case_id,version,pack_payload,sha256_hash) VALUES($1,$2,1,'{}','synthetic')",
      [other, c.id],
    ),
  "own-tenant pack cannot reference foreign case",
  "Case tenant mismatch",
);
await denied(
  () => db.query("SELECT persist_evidence_pack_atomic($1,$2)", [c.id, "{}"]),
  "cross-tenant generation blocked",
  "Investigator access required",
);
assert.equal(
  (await db.query("SELECT * FROM current_pack_source($1)", [c.id])).rows[0].current_pack_source
    .case,
  null,
);
await as(uid);
await db.query(
  "INSERT INTO contradictions(tenant_id,case_id,title,status) VALUES($1,$2,'SYNTHETIC new flag','FLAGGED')",
  [t, c.id],
);
await denied(
  async () => persist(await prepare(4)),
  "new FLAGGED source blocks atomic RPC",
  "BLOCKED",
);
await as(viewer);
let original = (await db.query("SELECT title FROM cases WHERE id=$1", [c.id])).rows[0].title;
await db.query("UPDATE cases SET title='SYNTHETIC forbidden viewer' WHERE id=$1", [c.id]);
assert.equal(
  (await db.query("SELECT title FROM cases WHERE id=$1", [c.id])).rows[0].title,
  original,
);
console.log("PASS restrictive viewer update filters core case and preserves read access");
await denied(
  () => db.query("INSERT INTO cases(tenant_id,reference_no) VALUES($1,'SYN-VIEWER-DENIED')", [t]),
  "viewer cannot insert core case",
);
await denied(
  () =>
    db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('case-documents',$1)", [
      t + "/synthetic.txt",
    ]),
  "viewer cannot upload case document",
);
await as(uid);
await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES('case-documents',$1)", [
  t + "/synthetic.txt",
]);
console.log("PASS investigator can still upload case document");
console.log("ATOMIC_PACK_LOCAL_PASS - not live multi-connection acceptance");
await db.close();
