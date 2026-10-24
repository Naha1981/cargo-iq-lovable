// RLS test: simulate Supabase authenticated role with per-user auth.uid().
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log("PASS", n); };
const bad = (n, e) => { fail++; console.log("FAIL", n, "-", e); };

await db.exec(`
create role authenticated nologin;
create role app_user nologin in role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.test_uid', true),'')::uuid $$;
grant usage on schema auth, public to authenticated;
create table public.tenants(id uuid primary key, name text);
create table public.user_roles(user_id uuid, tenant_id uuid, role text);
create table public.cases(id uuid primary key, tenant_id uuid, title text);
create table public.documents(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, name text, file_path text, file_type text, sha256_hash text, extraction_status text, created_at timestamptz default now());
create table public.extracted_claims(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, claim_text text, status text, created_at timestamptz default now());
create table public.contradictions(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, claim_a_id uuid, claim_b_id uuid, status text, created_at timestamptz default now());
create table public.timeline_events(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, provenance_id uuid, title text, created_at timestamptz default now());
create table public.external_observations(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, source text, created_at timestamptz default now());
create table public.financial_calculations(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, payload jsonb, created_at timestamptz default now());
create table public.commercial_rules(id uuid primary key default gen_random_uuid(), tenant_id uuid, payload jsonb, created_at timestamptz default now());
create table public.evidence_packs(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, created_at timestamptz default now());
create table public.audit_log(id uuid primary key default gen_random_uuid(), tenant_id uuid, case_id uuid, actor_user_id uuid, action text, created_at timestamptz default now());
create table public.cctv_sources(id uuid primary key default gen_random_uuid(), tenant_id uuid, name text, enabled boolean default true, created_by uuid, created_at timestamptz default now());
create table public.cctv_cameras(id uuid primary key default gen_random_uuid(), tenant_id uuid, source_id uuid, created_at timestamptz default now());
create table public.cctv_zones(id uuid primary key default gen_random_uuid(), tenant_id uuid, camera_id uuid, created_at timestamptz default now());
create table public.cctv_observations(id uuid primary key default gen_random_uuid(), tenant_id uuid, source_id uuid, camera_id uuid, zone_id uuid, case_id uuid, created_at timestamptz default now());
create table public.cctv_evidence_artifacts(id uuid primary key default gen_random_uuid(), tenant_id uuid, observation_id uuid, created_at timestamptz default now());
create function public.cargoiq_cctv_tenant_ids() returns setof uuid language sql stable security definer set search_path=public as $$ select tenant_id from public.user_roles where user_id=auth.uid() $$;
grant select,insert,update,delete on all tables in schema public to authenticated;
insert into public.tenants values ('11111111-1111-1111-1111-111111111111','A'),('22222222-2222-2222-2222-222222222222','B');
insert into public.user_roles values
 ('a0000000-0000-0000-0000-0000000000a2','11111111-1111-1111-1111-111111111111','investigator'),
 ('a0000000-0000-0000-0000-0000000000a3','11111111-1111-1111-1111-111111111111','viewer'),
 ('b0000000-0000-0000-0000-0000000000b2','22222222-2222-2222-2222-222222222222','investigator');
insert into public.cases values ('c1111111-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','CaseA'),('c2222222-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222222','CaseB');
`);

// Pre-guard state mirroring the live CCTV migration (member-wide modify) + tenant select on all
await db.exec(`
alter table public.user_roles enable row level security;
alter table public.cases enable row level security;
alter table public.documents enable row level security;
alter table public.cctv_sources enable row level security;
alter table public.cctv_cameras enable row level security;
alter table public.cctv_zones enable row level security;
alter table public.cctv_observations enable row level security;
alter table public.cctv_evidence_artifacts enable row level security;
create policy user_roles_self on public.user_roles for select to authenticated using (user_id=auth.uid());
create policy cases_tenant on public.cases for all to authenticated using (tenant_id in (select tenant_id from public.user_roles where user_id=auth.uid()));
create policy documents_tenant on public.documents for all to authenticated using (tenant_id in (select tenant_id from public.user_roles where user_id=auth.uid()));
create policy cctv_sources_sel on public.cctv_sources for select to authenticated using (tenant_id in (select public.cargoiq_cctv_tenant_ids()));
create policy cctv_sources_mod on public.cctv_sources for all to authenticated using (tenant_id in (select public.cargoiq_cctv_tenant_ids())) with check (tenant_id in (select public.cargoiq_cctv_tenant_ids()));
create policy cctv_cameras_sel on public.cctv_cameras for select to authenticated using (tenant_id in (select public.cargoiq_cctv_tenant_ids()));
create policy cctv_cameras_mod on public.cctv_cameras for all to authenticated using (tenant_id in (select public.cargoiq_cctv_tenant_ids())) with check (tenant_id in (select public.cargoiq_cctv_tenant_ids()));
create policy cctv_zones_sel on public.cctv_zones for select to authenticated using (tenant_id in (select public.cargoiq_cctv_tenant_ids()));
create policy cctv_zones_mod on public.cctv_zones for all to authenticated using (tenant_id in (select public.cargoiq_cctv_tenant_ids())) with check (tenant_id in (select public.cargoiq_cctv_tenant_ids()));
create policy cctv_obs_sel on public.cctv_observations for select to authenticated using (tenant_id in (select public.cargoiq_cctv_tenant_ids()));
create policy cctv_obs_mod on public.cctv_observations for all to authenticated using (tenant_id in (select public.cargoiq_cctv_tenant_ids())) with check (tenant_id in (select public.cargoiq_cctv_tenant_ids()));
create policy cctv_art_sel on public.cctv_evidence_artifacts for select to authenticated using (tenant_id in (select public.cargoiq_cctv_tenant_ids()));
create policy cctv_art_mod on public.cctv_evidence_artifacts for all to authenticated using (tenant_id in (select public.cargoiq_cctv_tenant_ids())) with check (tenant_id in (select public.cargoiq_cctv_tenant_ids()));
alter table public.user_roles force row level security;
alter table public.cases force row level security;
alter table public.documents force row level security;
alter table public.cctv_sources force row level security;
alter table public.cctv_cameras force row level security;
alter table public.cctv_zones force row level security;
alter table public.cctv_observations force row level security;
alter table public.cctv_evidence_artifacts force row level security;
`);

const T='11111111-1111-1111-1111-111111111111', CA='c1111111-1111-1111-1111-111111111111', CB='c2222222-2222-2222-2222-222222222222';
const INV='a0000000-0000-0000-0000-0000000000a2', VIEW='a0000000-0000-0000-0000-0000000000a3', INVB='b0000000-0000-0000-0000-0000000000b2';
const asUser = async (uid, sql) => {
  await db.query("BEGIN");
  await db.query("SET LOCAL ROLE app_user");
  await db.query(`SET LOCAL app.test_uid='${uid}'`);
  try { const r = await db.query(sql); await db.query("ROLLBACK"); return { ok: true, r }; }
  catch (e) { await db.query("ROLLBACK"); return { ok: false, e }; }
};
const expectOk = async (n, uid, sql) => { const r = await asUser(uid, sql); r.ok ? ok(n) : bad(n, r.e.message); };
const expectDenied = async (n, uid, sql) => {
  const r = await asUser(uid, sql);
  if (!r.ok) return ok(n);
  const affected = r.r?.affectedRows ?? r.r?.rows?.length ?? 0;
  affected === 0 ? ok(n) : bad(n, "statement affected " + affected + " rows");
};

// PRE-GUARD: prove the viewer bypass existed (documents/cctv modify allowed for any member)
await expectOk("PRE-GUARD viewer can insert+delete cctv source (vuln repro: insert)", VIEW, `insert into public.cctv_sources(tenant_id,name) values ('${T}','tmp')`);
await expectOk("PRE-GUARD viewer can insert+delete cctv source (vuln repro: delete)", VIEW, `delete from public.cctv_sources where tenant_id='${T}' and name='tmp'`);
await expectOk("PRE-GUARD viewer can insert document (vuln repro)", VIEW, `insert into public.documents(tenant_id,case_id,name) values ('${T}','${CA}','tmp')`);
await expectOk("PRE-GUARD viewer can delete document (vuln repro)", VIEW, `delete from public.documents where tenant_id='${T}' and name='tmp'`);

// storage.objects mock so the existing 16 Oct core guard can apply verbatim
await db.exec(`
create schema storage;
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now());
grant select,insert,update,delete on storage.objects to authenticated;
`);

// Apply guards verbatim: existing 16 Oct core guard first, then the two new ones
for (const f of ["supabase/migrations/20261016063000_core_viewer_readonly_guard.sql","supabase/migrations/20261024210000_evidence_immutability_guards.sql","supabase/migrations/20261024211000_cctv_role_guard.sql"]) {
  try { await db.exec(readFileSync(new URL("../"+f, import.meta.url), "utf8")); ok("apply "+f.split("/").pop()); }
  catch (e) { bad("apply "+f.split("/").pop(), e.message); }
}

// POST-GUARD: viewer writes denied on every guarded surface
await expectDenied("viewer insert cctv source denied", VIEW, `insert into public.cctv_sources(tenant_id,name) values ('${T}','x')`);
await expectDenied("viewer update cctv source denied", VIEW, `update public.cctv_sources set name='y' where tenant_id='${T}'`);
await expectDenied("viewer delete cctv source denied", VIEW, `delete from public.cctv_sources where tenant_id='${T}'`);
await expectDenied("viewer insert document denied (core guard)", VIEW, `insert into public.documents(tenant_id,case_id,name) values ('${T}','${CA}','x')`);
// investigator still works
await expectOk("investigator insert cctv source", INV, `insert into public.cctv_sources(tenant_id,name) values ('${T}','inv-src')`);
await expectOk("investigator insert document", INV, `insert into public.documents(tenant_id,case_id,name,file_path,sha256_hash) values ('${T}','${CA}','ok.pdf','${T}/${CA}/ok.pdf','h')`);
// tenant isolation: B investigator cannot see or touch A rows
await expectDenied("tenantB select A cases returns nothing", INVB, `select * from public.cases where tenant_id='${T}'`);
await expectDenied("tenantB insert into A documents", INVB, `insert into public.documents(tenant_id,case_id,name) values ('${T}','${CA}','x')`);
await expectDenied("tenantB modify A cctv", INVB, `insert into public.cctv_sources(tenant_id,name) values ('${T}','x')`);
// direct REST hostile: investigator A inserting doc pointing at B's case -> trigger blocks (RLS would pass tenant check)
await expectDenied("investigator A doc->case B blocked by trigger", INV, `insert into public.documents(tenant_id,case_id,name,file_path,sha256_hash) values ('${T}','${CB}','evil.pdf','${T}/${CB}/evil.pdf','h')`);
// viewer reads still fine
await expectOk("viewer can still select cases", VIEW, `select * from public.cases where tenant_id='${T}'`);

console.log(`\nRLS: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
