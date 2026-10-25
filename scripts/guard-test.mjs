// PGlite isolation test for the two guard migrations. Runs the migration SQL verbatim
// against a minimal base schema, then exercises legitimate and hostile flows.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
await db.query("create role authenticated nologin");
let pass = 0,
  fail = 0;
const ok = (name) => {
  pass++;
  console.log("PASS", name);
};
const bad = (name, e) => {
  fail++;
  console.log("FAIL", name, "-", e);
};
let sp = 0;
const guarded = async (fn) => {
  const spName = "sp" + ++sp;
  await db.query("SAVEPOINT " + spName);
  try {
    const r = await fn();
    await db.query("RELEASE SAVEPOINT " + spName);
    return { ok: true, r };
  } catch (e) {
    await db.query("ROLLBACK TO SAVEPOINT " + spName);
    return { ok: false, e };
  }
};
const mustThrow = async (name, sql, code) => {
  const r = await guarded(() => db.query(sql));
  if (r.ok) return bad(name, "expected error, succeeded");
  code && !String(r.e.message).includes(code) ? bad(name, r.e.message) : ok(name);
};
const mustPass = async (name, sql) => {
  const r = await guarded(() => db.exec(sql));
  r.ok ? ok(name) : bad(name, r.e.message);
};

const SCHEMA = `
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_uid', true),'')::uuid $$;
create table public.tenants(id uuid primary key, name text);
create table public.user_roles(user_id uuid, tenant_id uuid, role text);
create table public.cases(id uuid primary key, tenant_id uuid, title text);
create table public.documents(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, name text, file_path text, file_type text, sha256_hash text, extraction_status text, source_party text, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.extracted_claims(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, document_id uuid, claim_text text, claim_type text, normalized_value jsonb, evidence_class text, nature text, confidence numeric, timestamp_claimed timestamptz, event_reference text, page_number int, status text, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.contradictions(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, claim_a_id uuid, claim_b_id uuid, status text, resolution_note text, resolution_document_id uuid, resolution_evidence_reference text, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.timeline_events(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, provenance_id uuid, title text, "timestamp" timestamptz, source text, evidence_class text, nature text, coordinates jsonb, created_at timestamptz default now());
create table public.external_observations(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, source text, observation_type text, observed_at timestamptz, latitude numeric, longitude numeric, payload jsonb, confidence numeric, limitation text, created_at timestamptz default now());
create table public.financial_calculations(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, payload jsonb, created_at timestamptz default now());
create table public.evidence_packs(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, created_at timestamptz default now());
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
 ('a0000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111','investigator'),
 ('a0000000-0000-0000-0000-0000000000a3','11111111-1111-1111-1111-111111111111','viewer'),
 ('b0000000-0000-0000-0000-0000000000b1','22222222-2222-2222-2222-222222222222','investigator');
insert into public.cases values ('c1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','CaseA'),('c2222222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222222','CaseB');
`;
await db.exec(SCHEMA);

// Apply the three migrations verbatim
for (const f of [
  "supabase/migrations/20261024210000_evidence_immutability_guards.sql",
  "supabase/migrations/20261024211000_cctv_role_guard.sql",
  "supabase/migrations/20261024215000_audit_actor_guard.sql",
]) {
  try {
    await db.exec(readFileSync(new URL("../" + f, import.meta.url), "utf8"));
    ok("apply " + f.split("/").pop());
  } catch (e) {
    bad("apply " + f.split("/").pop(), e.message);
  }
}

// Re-apply both migrations verbatim: must no-op cleanly (post-manual-apply publish path)
for (const f of [
  "supabase/migrations/20261024210000_evidence_immutability_guards.sql",
  "supabase/migrations/20261024211000_cctv_role_guard.sql",
  "supabase/migrations/20261024215000_audit_actor_guard.sql",
]) {
  try {
    await db.exec(readFileSync(new URL("../" + f, import.meta.url), "utf8"));
    ok("re-apply no-op " + f.split("/").pop());
  } catch (e) {
    bad("re-apply no-op " + f.split("/").pop(), e.message);
  }
}

// Wrong-definition decoy must abort loudly, never silently trusted
{
  const db2 = new PGlite();
  await db2.query("create role authenticated nologin");
  await db2.exec(SCHEMA);
  await db2.exec(`create function public.guard_evil() returns trigger language plpgsql as $decoy$ BEGIN RETURN NEW; END $decoy$;
    create trigger evidence_immutable_guard before update or delete on public.documents for each row execute function public.guard_evil();`);
  try {
    await db2.exec(
      readFileSync(
        new URL(
          "../supabase/migrations/20261024210000_evidence_immutability_guards.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    bad("decoy guard abort", "expected error, succeeded");
  } catch (e) {
    String(e.message).includes("unexpected definition")
      ? ok("decoy guard abort")
      : bad("decoy guard abort", e.message);
  }
  await db2.close();
}

await db.query("BEGIN");
const T = "11111111-1111-1111-1111-111111111111",
  CA = "c1111111-1111-1111-1111-111111111111",
  CB = "c2222222-2222-2222-2222-222222222222";

// --- documents ---
await mustPass(
  "doc insert",
  `insert into public.documents(tenant_id,case_id,name,file_path,file_type,sha256_hash) values ('${T}','${CA}','invoice.pdf','${T}/${CA}/invoice.pdf','pdf','hash1')`,
);
await mustPass(
  "doc extraction_status update (app flow)",
  `update public.documents set extraction_status='DONE' where case_id='${CA}'`,
);
await mustThrow(
  "doc sha256 tamper",
  `update public.documents set sha256_hash='evil' where case_id='${CA}'`,
  "EVIDENCE_DOCUMENT_CONTENT_IMMUTABLE",
);
await mustThrow(
  "doc file_path tamper",
  `update public.documents set file_path='x' where case_id='${CA}'`,
  "EVIDENCE_DOCUMENT_CONTENT_IMMUTABLE",
);
await mustThrow(
  "doc delete",
  `delete from public.documents where case_id='${CA}'`,
  "EVIDENCE_DOCUMENT_DELETE_BLOCKED",
);
await mustThrow(
  "doc cross-tenant case_id (direct REST path)",
  `insert into public.documents(tenant_id,case_id,name,file_path,file_type,sha256_hash) values ('${T}','${CB}','evil.pdf','${T}/${CB}/evil.pdf','pdf','h')`,
  "CASE_TENANT_MISMATCH",
);

// --- claims: review + re-extraction flows ---
await mustPass(
  "claim insert PENDING",
  `insert into public.extracted_claims(tenant_id,case_id,claim_text,status) values ('${T}','${CA}','vessel arrived','PENDING')`,
);
const {
  rows: [claim],
} = await db.query(`select id from public.extracted_claims where case_id='${CA}' limit 1`);
await mustPass(
  "claim review PENDING->VERIFIED (app flow)",
  `update public.extracted_claims set status='VERIFIED', updated_at=now() where id='${claim.id}'`,
);
await mustThrow(
  "claim text tamper",
  `update public.extracted_claims set claim_text='forged' where id='${claim.id}'`,
  "EVIDENCE_CLAIM_CONTENT_IMMUTABLE",
);
await mustThrow(
  "verified claim re-review blocked",
  `update public.extracted_claims set status='DISPUTED' where id='${claim.id}'`,
  "EVIDENCE_CLAIM_REVIEWED_STATUS_LOCKED",
);
await mustThrow(
  "verified claim delete",
  `delete from public.extracted_claims where id='${claim.id}'`,
  "EVIDENCE_CLAIM_DELETE_BLOCKED",
);
await mustPass(
  "re-extraction: pending claim delete (app flow)",
  `insert into public.extracted_claims(tenant_id,case_id,claim_text,status) values ('${T}','${CA}','stale','PENDING'); delete from public.extracted_claims where claim_text='stale'`,
);

// --- timeline events ---
const {
  rows: [pend],
} = await db.query(
  `insert into public.extracted_claims(tenant_id,case_id,claim_text,status) values ('${T}','${CA}','pend2','PENDING') returning id`,
);
await mustPass(
  "timeline insert",
  `insert into public.timeline_events(tenant_id,case_id,provenance_id,title) values ('${T}','${CA}','${pend.id}','evt')`,
);
await mustPass(
  "timeline delete tied to PENDING claim (re-extract flow)",
  `delete from public.timeline_events where provenance_id='${pend.id}'`,
);
await mustPass(
  "timeline insert for verified claim",
  `insert into public.timeline_events(tenant_id,case_id,provenance_id,title) values ('${T}','${CA}','${claim.id}','evt2')`,
);
await mustThrow(
  "timeline delete tied to VERIFIED claim",
  `delete from public.timeline_events where provenance_id='${claim.id}'`,
  "EVIDENCE_TIMELINE_DELETE_BLOCKED",
);
await mustThrow(
  "timeline update",
  `update public.timeline_events set title='x' where case_id='${CA}'`,
  "EVIDENCE_TIMELINE_UPDATE_BLOCKED",
);

// --- contradictions ---
await mustPass(
  "contradiction insert FLAGGED",
  `insert into public.contradictions(tenant_id,case_id,claim_a_id,claim_b_id,status) values ('${T}','${CA}','${claim.id}','${pend.id}','FLAGGED')`,
);
const {
  rows: [contra],
} = await db.query(`select id from public.contradictions where case_id='${CA}' limit 1`);
await mustPass(
  "contradiction resolve (app flow)",
  `update public.contradictions set status='RESOLVED', resolution_note='explained fully here', resolution_document_id=(select id from public.documents limit 1), resolution_evidence_reference='p1' where id='${contra.id}'`,
);
await mustThrow(
  "resolved contradiction re-open",
  `update public.contradictions set status='FLAGGED' where id='${contra.id}'`,
  "EVIDENCE_CONTRADICTION_RESOLUTION_LOCKED",
);
await mustThrow(
  "resolved contradiction delete",
  `delete from public.contradictions where id='${contra.id}'`,
  "EVIDENCE_CONTRADICTION_DELETE_BLOCKED",
);

// --- financial / external / audit ---
await mustPass(
  "financial insert",
  `insert into public.financial_calculations(tenant_id,case_id,payload) values ('${T}','${CA}','{}')`,
);
await mustThrow(
  "financial update",
  `update public.financial_calculations set payload='{}' where case_id='${CA}'`,
  "UPDATE_BLOCKED",
);
await mustThrow(
  "financial delete",
  `delete from public.financial_calculations where case_id='${CA}'`,
  "DELETE_BLOCKED",
);
await mustPass(
  "external obs insert",
  `insert into public.external_observations(tenant_id,case_id,source) values ('${T}','${CA}','AIS')`,
);
await mustThrow(
  "external obs update",
  `update public.external_observations set source='x' where case_id='${CA}'`,
  "UPDATE_BLOCKED",
);
await mustPass(
  "audit insert",
  `insert into public.audit_log(tenant_id,case_id,actor_user_id,action) values ('${T}','${CA}','a0000000-0000-0000-0000-0000000000a2','TEST')`,
);
await mustThrow(
  "audit forged-actor update",
  `update public.audit_log set actor_user_id='b0000000-0000-0000-0000-0000000000b1' where case_id='${CA}'`,
  "AUDIT_LOG_APPEND_ONLY",
);
await mustThrow(
  "audit delete",
  `delete from public.audit_log where case_id='${CA}'`,
  "AUDIT_LOG_APPEND_ONLY",
);
await db.query("SET app.test_uid = 'a0000000-0000-0000-0000-0000000000a2'");
await mustThrow(
  "audit forged-actor INSERT (authenticated as another user)",
  `insert into public.audit_log(tenant_id,case_id,actor_user_id,action,entity_type) values ('${T}','${CA}','a0000000-0000-0000-0000-0000000000a1','CASE_CREATED','case')`,
  "AUDIT_ACTOR_MISMATCH",
);
await mustPass(
  "audit INSERT with own actor (authenticated)",
  `insert into public.audit_log(tenant_id,case_id,actor_user_id,action,entity_type) values ('${T}','${CA}','a0000000-0000-0000-0000-0000000000a2','CASE_CREATED','case')`,
);
await db.query("RESET app.test_uid");
await mustPass(
  "audit INSERT explicit actor via service role (auth.uid null)",
  `insert into public.audit_log(tenant_id,case_id,actor_user_id,action,entity_type) values ('${T}','${CA}','a0000000-0000-0000-0000-0000000000a1','CASE_CREATED','case')`,
);
await mustThrow(
  "audit cross-tenant case_id",
  `insert into public.audit_log(tenant_id,case_id,actor_user_id,action) values ('${T}','${CB}','a0000000-0000-0000-0000-0000000000a2','X')`,
  "CASE_TENANT_MISMATCH",
);

// --- case delete guard ---
await mustPass(
  "pack insert",
  `insert into public.evidence_packs(tenant_id,case_id) values ('${T}','${CA}')`,
);
await mustThrow(
  "case delete with packs",
  `delete from public.cases where id='${CA}'`,
  "CASE_HAS_EVIDENCE_PACKS_DELETE_BLOCKED",
);
await mustPass(
  "case delete without packs",
  `insert into public.cases values ('c3333333-3333-3333-3333-333333333333','${T}','Tmp'); delete from public.cases where id='c3333333-3333-3333-3333-333333333333'`,
);

console.log(`\nTRIGGERS: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
