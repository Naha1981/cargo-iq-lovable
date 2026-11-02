import { afterAll, beforeAll, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const db = new PGlite();
const U = "a0000000-0000-4000-8000-000000000001";
const V = "a0000000-0000-4000-8000-000000000002";
let tenant: string;
beforeAll(async () => {
  await db.exec(`create role authenticated nologin; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.uid',true),'')::uuid$$;
    create table tenants(id uuid primary key default gen_random_uuid(), name text);
    create table user_roles(user_id uuid,tenant_id uuid,role text,created_at timestamptz default now());
    create table extracted_claims(id uuid primary key default gen_random_uuid(),tenant_id uuid,case_id uuid,document_id uuid,claim_text text,claim_type text,normalized_value jsonb,evidence_class text,nature text,timestamp_claimed timestamptz,status text default 'PENDING',updated_at timestamptz default now());
    create function seed_demo_case(uuid,uuid) returns void language plpgsql as $$begin raise exception 'MUST_NOT_SEED';end$$;`);
  await db.exec(
    readFileSync("supabase/migrations/20261101151000_no_automatic_sample_case.sql", "utf8"),
  );
  await db.exec(
    readFileSync(
      "supabase/migrations/20261102020000_claim_review_schema_compatibility.sql",
      "utf8",
    ),
  );
  await db.exec(`create trigger evidence_immutable_guard before update or delete on extracted_claims for each row execute function guard_evidence_immutable();
    alter table extracted_claims enable row level security;
    create policy own_tenant on extracted_claims using (tenant_id in (select tenant_id from user_roles where user_id=auth.uid())) with check (tenant_id in (select tenant_id from user_roles where user_id=auth.uid()));
    grant usage on schema public,auth to authenticated; grant select,insert,update on all tables in schema public to authenticated;`);
});
afterAll(async () => db.close());
async function identity(uid: string) {
  await db.exec(`set role authenticated;set app.uid='${uid}'`);
}
it("new signup provisions a clean workspace, repeat sign-in returns the same tenant", async () => {
  await identity(U);
  tenant = (
    await db.query<{ id: string }>(
      "select provision_organization('SYNTHETIC TEST NOT CUSTOMER') id",
    )
  ).rows[0].id;
  expect((await db.query("select * from extracted_claims")).rows).toHaveLength(0);
  expect(
    (await db.query<{ id: string }>("select provision_organization('returning') id")).rows[0].id,
  ).toBe(tenant);
  expect((await db.query("select * from user_roles where user_id=auth.uid()")).rows).toHaveLength(
    1,
  );
});
it("both Verify and Dispute persist across fresh reads and signout/signin on schema without event_reference", async () => {
  await identity(U);
  for (const status of ["VERIFIED", "DISPUTED"]) {
    const id = (
      await db.query<{ id: string }>(
        "insert into extracted_claims(tenant_id,case_id,claim_text) values ($1,gen_random_uuid(),'SYNTHETIC NOT CUSTOMER') returning id",
        [tenant],
      )
    ).rows[0].id;
    await db.query("update extracted_claims set status=$1 where id=$2", [status, id]);
    await db.exec("set app.uid=''");
    expect((await db.query("select * from extracted_claims where id=$1", [id])).rows).toHaveLength(
      0,
    );
    await identity(U);
    expect(
      (await db.query<{ status: string }>("select status from extracted_claims where id=$1", [id]))
        .rows[0].status,
    ).toBe(status);
  }
});
it("other tenants cannot read or change saved work", async () => {
  await identity(V);
  const other = (
    await db.query<{ id: string }>("select provision_organization('SYNTHETIC OTHER TENANT') id")
  ).rows[0].id;
  expect(other).not.toBe(tenant);
  expect((await db.query("select * from extracted_claims")).rows).toHaveLength(0);
  expect(
    (await db.query("update extracted_claims set status='VERIFIED' returning id")).rows,
  ).toHaveLength(0);
});
it("review and evidence content locks remain intact", async () => {
  await identity(U);
  await expect(db.query("update extracted_claims set claim_text='tampered'")).rejects.toThrow(
    "EVIDENCE_CLAIM_CONTENT_IMMUTABLE",
  );
  await expect(db.query("update extracted_claims set status='PENDING'")).rejects.toThrow(
    "EVIDENCE_CLAIM_REVIEWED_STATUS_LOCKED",
  );
  await expect(db.query("delete from extracted_claims")).rejects.toThrow();
});
it("optional event_reference remains immutable when an environment has that column", async () => {
  await db.exec("reset role;alter table extracted_claims add column event_reference text;");
  await identity(U);
  await expect(db.query("update extracted_claims set event_reference='tampered'")).rejects.toThrow(
    "EVIDENCE_CLAIM_CONTENT_IMMUTABLE",
  );
});
