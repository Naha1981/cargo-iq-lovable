// PGlite test for 20261024217000_atomic_reextraction.sql (replace_pending_claims RPC),
// applied verbatim AFTER the real live guard migrations, so the RPC is exercised against
// the actual guard definitions it must coexist with - not a guard-free schema.
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

const SCHEMA = `
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_uid', true),'')::uuid $$;
create table public.tenants(id uuid primary key, name text);
create table public.user_roles(user_id uuid, tenant_id uuid, role text);
create table public.cases(id uuid primary key, tenant_id uuid, title text);
create table public.documents(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, name text, file_path text, file_type text, sha256_hash text, extraction_status text, source_party text, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.extracted_claims(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, document_id uuid, claim_text text not null, claim_type text, normalized_value jsonb, evidence_class text, nature text, confidence numeric, timestamp_claimed timestamptz, event_reference text, page_number int, status text, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.contradictions(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, claim_a_id uuid, claim_b_id uuid, status text, resolution_note text, resolution_document_id uuid, resolution_evidence_reference text, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.timeline_events(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, provenance_id uuid, title text, "timestamp" timestamptz, source text, evidence_class text, nature text, coordinates jsonb, created_at timestamptz default now());
create table public.external_observations(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, source text, observation_type text, observed_at timestamptz, latitude numeric, longitude numeric, payload jsonb, confidence numeric, limitation text, created_at timestamptz default now());
create table public.financial_calculations(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, payload jsonb, created_at timestamptz default now());
create table public.evidence_packs(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, version int, pack_payload jsonb, canonical_payload jsonb, sha256_hash text, status text, created_at timestamptz default now());
create table public.audit_log(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, actor_user_id uuid, action text, entity_type text, entity_id uuid, payload jsonb, created_at timestamptz default now());
create table public.cctv_sources(id uuid primary key default gen_random_uuid(), tenant_id uuid, name text, enabled boolean default true, created_by uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.cctv_cameras(id uuid primary key default gen_random_uuid(), tenant_id uuid, source_id uuid, created_at timestamptz default now());
create table public.cctv_zones(id uuid primary key default gen_random_uuid(), tenant_id uuid, camera_id uuid, created_at timestamptz default now());
create table public.cctv_observations(id uuid primary key default gen_random_uuid(), tenant_id uuid, source_id uuid, camera_id uuid, zone_id uuid, case_id uuid, created_at timestamptz default now());
create table public.cctv_evidence_artifacts(id uuid primary key default gen_random_uuid(), tenant_id uuid, observation_id uuid, created_at timestamptz default now());
create table public.cctv_ingest_nonces(id bigint generated always as identity primary key, source_id uuid, nonce text, observed_at timestamptz);
insert into public.tenants values ('11111111-1111-1111-1111-111111111111','TenantA'),('22222222-2222-2222-2222-222222222222','TenantB');
insert into public.user_roles values
 ('a0000000-0000-0000-0000-0000000000a1','11111111-1111-1111-1111-111111111111','admin'),
 ('a0000000-0000-0000-0000-0000000000a3','11111111-1111-1111-1111-111111111111','viewer'),
 ('b0000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','investigator');
insert into public.cases values ('c1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','CaseA'),('c2222222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222222','CaseB');
insert into public.documents(id,tenant_id,case_id,name) values ('d1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','c1111111-1111-1111-1111-111111111111','pod.pdf');
`;

const ADMIN = "a0000000-0000-0000-0000-0000000000a1";
const VIEWER = "a0000000-0000-0000-0000-0000000000a3";
const TENANT_B_INV = "b0000000-0000-0000-0000-0000000000b1";
const CASE_A = "c1111111-1111-1111-1111-111111111111";
const DOC = "d1111111-1111-1111-1111-111111111111";

async function makeDb(extraColumn) {
  const db = new PGlite();
  await db.query("create role authenticated nologin");
  await db.query("create role anon nologin");
  await db.exec(
    SCHEMA +
      (extraColumn ? "alter table public.extracted_claims add column source_seq integer;" : ""),
  );
  // Real guards first (verbatim), then the new RPC migration (verbatim).
  for (const f of [
    "supabase/migrations/20261024210000_evidence_immutability_guards.sql",
    "supabase/migrations/20261024211000_cctv_role_guard.sql",
    "supabase/migrations/20261024215000_audit_actor_guard.sql",
    "supabase/migrations/20261024217000_atomic_reextraction.sql",
  ]) {
    await db.exec(readFileSync(new URL("../" + f, import.meta.url), "utf8"));
  }
  return db;
}

// Seed a realistic pre-reextraction state: one VERIFIED claim (untouchable), one PENDING
// claim with provenance timeline + FLAGGED contradiction, and a SEALED pack whose payload
// snapshot embeds the PENDING claim's id (packs are snapshots - no FK to claims).
async function seed(db) {
  await db.exec(`
    insert into public.extracted_claims(id,tenant_id,case_id,document_id,claim_text,status,evidence_class,nature,timestamp_claimed)
    values ('e1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','${CASE_A}','${DOC}','Verified fact','VERIFIED','A','asserted',now()),
           ('e2222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','${CASE_A}','${DOC}','Stale pending reading','PENDING','B','asserted',now()),
           ('e3333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','${CASE_A}','${DOC}','Other pending','PENDING','B','asserted',null);
    insert into public.timeline_events(tenant_id,case_id,provenance_id,title,"timestamp",source,evidence_class,nature)
    values ('11111111-1111-1111-1111-111111111111','${CASE_A}','e1111111-1111-1111-1111-111111111111','Verified event',now(),'pod.pdf','A','asserted'),
           ('11111111-1111-1111-1111-111111111111','${CASE_A}','e2222222-2222-2222-2222-222222222222','Stale event',now(),'pod.pdf','B','asserted');
    insert into public.contradictions(tenant_id,case_id,claim_a_id,claim_b_id,status)
    values ('11111111-1111-1111-1111-111111111111','${CASE_A}','e1111111-1111-1111-1111-111111111111','e2222222-2222-2222-2222-222222222222','FLAGGED'),
           ('11111111-1111-1111-1111-111111111111','${CASE_A}','e1111111-1111-1111-1111-111111111111','e1111111-1111-1111-1111-111111111111','RESOLVED');
    insert into public.evidence_packs(tenant_id,case_id,version,pack_payload,status,sha256_hash)
    values ('11111111-1111-1111-1111-111111111111','${CASE_A}',1,'{"claims":[{"id":"e2222222-2222-2222-2222-222222222222","claim_text":"Stale pending reading"}]}','SEALED','abc123');
  `);
}

const CLAIMS = JSON.stringify([
  {
    claim_text: "Fresh reading one",
    claim_type: "fact",
    evidence_class: "B",
    nature: "asserted",
    timestamp_claimed: "2026-10-20T10:00:00Z",
    page_number: 2,
    source_name: "pod.pdf",
  },
  {
    claim_text: "Fresh reading two",
    claim_type: "fact",
    evidence_class: "A",
    nature: "asserted",
    event_reference: "EVT-9",
    normalized_value: { amount: 1200 },
    source_name: "pod.pdf",
  },
]);

const db = await makeDb(false); // no source_seq column: exercises the no-seq branch
await seed(db);

// 1. Tenant isolation: Tenant B investigator cannot touch Tenant A's case
await db.query(`SET app.test_uid = '${TENANT_B_INV}'`);
try {
  await db.query(`select public.replace_pending_claims('${CASE_A}','${DOC}','[]'::jsonb,true)`);
  bad("tenant isolation", "expected FORBIDDEN, succeeded");
} catch (e) {
  String(e.message).includes("FORBIDDEN")
    ? ok("tenant isolation")
    : bad("tenant isolation", e.message);
}

// 2. Viewer role forbidden
await db.query(`SET app.test_uid = '${VIEWER}'`);
try {
  await db.query(`select public.replace_pending_claims('${CASE_A}','${DOC}','[]'::jsonb,true)`);
  bad("viewer forbidden", "expected FORBIDDEN, succeeded");
} catch (e) {
  String(e.message).includes("FORBIDDEN")
    ? ok("viewer forbidden")
    : bad("viewer forbidden", e.message);
}

// 3. Unauthenticated forbidden
await db.query("RESET app.test_uid");
try {
  await db.query(`select public.replace_pending_claims('${CASE_A}','${DOC}','[]'::jsonb,true)`);
  bad("unauthenticated forbidden", "expected UNAUTHENTICATED, succeeded");
} catch (e) {
  String(e.message).includes("UNAUTHENTICATED")
    ? ok("unauthenticated forbidden")
    : bad("unauthenticated forbidden", e.message);
}

// 4. Atomic replace under live guards: PENDING replaced, VERIFIED + provenance + sealed pack untouched
await db.query(`SET app.test_uid = '${ADMIN}'`);
const res = await db.query(
  `select public.replace_pending_claims('${CASE_A}','${DOC}','${CLAIMS.replace(/'/g, "''")}'::jsonb,true) as r`,
);
const inserted = res.rows[0].r;
const counts = await db.query(`
  select
   (select count(*) from public.extracted_claims where case_id='${CASE_A}' and status='PENDING') as pending,
   (select count(*) from public.extracted_claims where id='e1111111-1111-1111-1111-111111111111') as verified_kept,
   (select count(*) from public.extracted_claims where id in ('e2222222-2222-2222-2222-222222222222','e3333333-3333-3333-3333-333333333333')) as stale_gone,
   (select count(*) from public.timeline_events where provenance_id='e1111111-1111-1111-1111-111111111111') as verified_prov_kept,
   (select count(*) from public.timeline_events where provenance_id='e2222222-2222-2222-2222-222222222222') as stale_prov_gone,
   (select count(*) from public.contradictions where status='FLAGGED') as flagged_gone,
   (select count(*) from public.contradictions where status='RESOLVED') as resolved_kept,
   (select count(*) from public.evidence_packs where status='SEALED' and pack_payload::text like '%e2222222%') as pack_snapshot_kept
`);
const c = counts.rows[0];
inserted.length === 2 &&
c.pending == 2 &&
c.verified_kept == 1 &&
c.stale_gone == 0 &&
c.verified_prov_kept == 1 &&
c.stale_prov_gone == 0 &&
c.flagged_gone == 0 &&
c.resolved_kept == 1 &&
c.pack_snapshot_kept == 1
  ? ok("atomic replace under guards (verified/provenance/sealed-pack preserved)")
  : bad("atomic replace under guards", JSON.stringify(c) + " inserted:" + JSON.stringify(inserted));

// 5. New claims got provenance timeline rows; event_reference folded into normalized_value
const prov = await db.query(`
  select count(*) as with_prov from public.timeline_events te
  join public.extracted_claims ec on ec.id=te.provenance_id
  where ec.case_id='${CASE_A}' and ec.status='PENDING'`);
const fold = await db.query(
  `select normalized_value from public.extracted_claims where claim_text='Fresh reading two'`,
);
prov.rows[0].with_prov == 1 &&
fold.rows[0].normalized_value.event_reference === "EVT-9" &&
fold.rows[0].normalized_value.source_value.amount === 1200
  ? ok("provenance created + event_reference folded")
  : bad("provenance/event_reference", JSON.stringify([prov.rows[0], fold.rows[0]]));

// 6. Atomicity on failure: second claim invalid (null claim_text violates NOT NULL) ->
// whole call rolls back; pre-existing PENDING claims and their provenance survive.
await seedReset(db);
const beforeFail = await db.query(
  `select count(*) as n from public.extracted_claims where status='PENDING'`,
);
try {
  await db.query(
    `select public.replace_pending_claims('${CASE_A}','${DOC}','[{"claim_text":"ok first","source_name":"pod.pdf"},{"claim_text":null,"source_name":"pod.pdf"}]'::jsonb,true)`,
  );
  bad("failure atomicity", "expected NOT NULL violation, succeeded");
} catch (e) {
  const afterFail = await db.query(
    `select count(*) as n from public.extracted_claims where status='PENDING'`,
  );
  const provAfter = await db.query(
    `select count(*) as n from public.timeline_events where provenance_id='e2222222-2222-2222-2222-222222222222'`,
  );
  String(e.message).includes("null") &&
  afterFail.rows[0].n === beforeFail.rows[0].n &&
  beforeFail.rows[0].n == 2 &&
  provAfter.rows[0].n == 1
    ? ok("failure rolls back everything, old evidence intact")
    : bad(
        "failure atomicity",
        e.message + " before:" + beforeFail.rows[0].n + " after:" + afterFail.rows[0].n,
      );
}

async function seedReset(db2) {
  // restore the two stale pending claims + provenance deleted by scenario 4
  await db2.exec(`
    delete from public.extracted_claims where case_id='${CASE_A}' and status='PENDING';
    insert into public.extracted_claims(id,tenant_id,case_id,document_id,claim_text,status,evidence_class,nature,timestamp_claimed)
    values ('e2222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','${CASE_A}','${DOC}','Stale pending reading','PENDING','B','asserted',now()),
           ('e3333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111','${CASE_A}','${DOC}','Other pending','PENDING','B','asserted',null);
    insert into public.timeline_events(tenant_id,case_id,provenance_id,title,"timestamp",source,evidence_class,nature)
    values ('11111111-1111-1111-1111-111111111111','${CASE_A}','e2222222-2222-2222-2222-222222222222','Stale event',now(),'pod.pdf','B','asserted');
  `);
}

// 6b. Retention: the replacement is recorded in append-only audit_log with the replaced
// claims' ids + texts, actor named (satisfies audit_actor_guard), BEFORE deletion.
const audit = await db.query(
  `select actor_user_id, action, entity_id, payload from public.audit_log where action='REEXTRACTION_REPLACED_PENDING'`,
);
const pl = audit.rows[0]?.payload;
const rc = pl.replaced_claims ?? [];
const removedC = pl.removed_contradictions ?? [];
const removedP = pl.removed_provenance ?? [];
audit.rows.length === 1 &&
audit.rows[0].actor_user_id === ADMIN &&
audit.rows[0].entity_id === DOC &&
rc.length === 2 &&
rc.some((r) => r.claim_text === "Stale pending reading") &&
rc.every((r) => r.status === "PENDING") &&
rc.every(
  (r) =>
    r.document_id === DOC &&
    r.tenant_id &&
    r.evidence_class &&
    "timestamp_claimed" in r &&
    "normalized_value" in r,
) &&
removedC.length === 1 &&
removedC[0].claim_a_id &&
removedC[0].claim_b_id &&
removedC[0].status === "FLAGGED" &&
removedP.length === 1 &&
removedP[0].provenance_id &&
removedP[0].title === "Stale event" &&
removedP[0].source === "pod.pdf"
  ? ok(
      "replacement recorded in audit_log (full claims + contradiction links + provenance reconstructable)",
    )
  : bad("audit retention", JSON.stringify(audit.rows));

// 7. Import mode (_replace_pending=false): appends, never deletes
const res2 = await db.query(
  `select public.replace_pending_claims('${CASE_A}','${DOC}','[{"claim_text":"Imported extra","source_name":"pod.pdf"}]'::jsonb,false) as r`,
);
const afterImport = await db.query(
  `select count(*) as n from public.extracted_claims where case_id='${CASE_A}' and status='PENDING'`,
);
res2.rows[0].r.length === 1 && afterImport.rows[0].n == 3
  ? ok("import mode appends only")
  : bad("import mode", JSON.stringify(afterImport.rows[0]));

// 8. Guards still bite after RPC exists: direct UPDATE on a VERIFIED claim is blocked
try {
  await db.query(
    `update public.extracted_claims set claim_text='tampered' where id='e1111111-1111-1111-1111-111111111111'`,
  );
  bad("guards still enforced", "expected guard abort, succeeded");
} catch (e) {
  ok("guards still enforced after RPC");
}

// 9. source_seq branch: separate DB WITH the column records reading order
{
  const dbSeq = await makeDb(true);
  await seed(dbSeq);
  await dbSeq.query(`SET app.test_uid = '${ADMIN}'`);
  await dbSeq.query(
    `select public.replace_pending_claims('${CASE_A}','${DOC}','${CLAIMS.replace(/'/g, "''")}'::jsonb,true)`,
  );
  const seq = await dbSeq.query(
    `select source_seq from public.extracted_claims where case_id='${CASE_A}' and status='PENDING' order by source_seq`,
  );
  seq.rows.length === 2 && seq.rows[0].source_seq === 1 && seq.rows[1].source_seq === 2
    ? ok("source_seq branch records reading order")
    : bad("source_seq branch", JSON.stringify(seq.rows));
  await dbSeq.close();
}

await db.close();
console.log(fail === 0 ? `ALL ${pass} PASSED` : `${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
