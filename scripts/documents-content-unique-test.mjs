// PGlite test for 20261025230000_documents_content_unique.sql (v2: atomic
// content ownership via companion table + claim trigger, non-destructive).
// Proves: clean apply creates the mechanism; losing same-content claim is
// 23505; cross-case/cross-content/cross-tenant inserts stay allowed;
// pre-existing duplicates are PRESERVED with canonical backfill (never
// silently deduped) and cannot be extended; backdating cannot bypass;
// re-apply is idempotent; an approved documents delete frees the content.
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
const T = "11111111-1111-1111-1111-111111111111";
const T2 = "99999999-9999-9999-9999-999999999999";
const C1 = "22222222-2222-2222-2222-222222222222";
const C2 = "33333333-3333-3333-3333-333333333333";
const migration = readFileSync(
  new URL("../supabase/migrations/20261025230000_documents_content_unique.sql", import.meta.url),
  "utf8",
);
const newDb = async () => {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create table public.documents(
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null, case_id uuid not null,
    name text, file_path text, sha256_hash text,
    uploaded_at timestamptz not null default now())`);
  return db;
};
const is23505 = (e) => e && e.code === "23505";

// 1) Clean apply creates table, trigger function, trigger.
{
  const db = await newDb();
  try {
    await db.exec(migration);
    const { rows: t } = await db.query(
      `select 1 from pg_tables where tablename='document_content_ownership'`,
    );
    const { rows: f } = await db.query(
      `select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='claim_document_content_ownership'`,
    );
    const { rows: tr } = await db.query(
      `select 1 from pg_trigger where tgname='documents_content_ownership_claim'`,
    );
    if (!t.length || !f.length || !tr.length) throw new Error("mechanism incomplete");
    ok("clean apply creates ownership table, claim function and trigger");
  } catch (e) {
    bad("clean apply", e);
  }

  // 2) Losing same-content claim is 23505.
  try {
    await db.query(
      `insert into public.documents(tenant_id,case_id,sha256_hash) values ($1,$2,'aaa')`,
      [T, C1],
    );
    await db.query(
      `insert into public.documents(tenant_id,case_id,sha256_hash) values ($1,$2,'aaa')`,
      [T, C1],
    );
    bad("race closed", "duplicate insert succeeded");
  } catch (e) {
    is23505(e)
      ? ok("same tenant+case+content twice: loser rejected 23505 - race closed by the database")
      : bad("race closed", e);
  }

  // 3) Different case, different content, and SAME content in another tenant all allowed (isolation).
  try {
    await db.query(
      `insert into public.documents(tenant_id,case_id,sha256_hash) values ($1,$2,'aaa')`,
      [T, C2],
    );
    await db.query(
      `insert into public.documents(tenant_id,case_id,sha256_hash) values ($1,$2,'bbb')`,
      [T, C1],
    );
    await db.query(
      `insert into public.documents(tenant_id,case_id,sha256_hash) values ($1,$2,'aaa')`,
      [T2, C1],
    );
    ok("different case, different content, and cross-tenant same content all allowed");
  } catch (e) {
    bad("allowed non-duplicates", e);
  }

  // 4) Re-apply idempotent.
  try {
    await db.exec(migration);
    ok("re-apply idempotent");
  } catch (e) {
    bad("idempotent re-apply", e);
  }

  // 5) Approved delete frees the content (cascade).
  try {
    await db.query(
      `delete from public.documents where tenant_id=$1 and case_id=$2 and sha256_hash='bbb'`,
      [T, C1],
    );
    await db.query(
      `insert into public.documents(tenant_id,case_id,sha256_hash) values ($1,$2,'bbb')`,
      [T, C1],
    );
    ok("documents delete cascades ownership - content re-claimable");
  } catch (e) {
    bad("delete frees content", e);
  }
}

// 6) Pre-existing duplicates: applies (WARNING, not exception), preserves all
// rows, backfills the earliest as canonical, and the group cannot be extended -
// including by a BACKDATED insert.
{
  const db = await newDb();
  try {
    await db.query(
      `insert into public.documents(tenant_id,case_id,sha256_hash,uploaded_at) values
       ($1,$2,'dup','2026-10-26T05:13:00+00'),($1,$2,'dup','2026-10-26T05:14:00+00')`,
      [T, C1],
    );
    await db.exec(migration);
    const {
      rows: [{ n }],
    } = await db.query(`select count(*)::int n from public.documents`);
    if (n !== 2) throw new Error("rows changed: " + n);
    const {
      rows: [o],
    } = await db.query(
      `select o.document_id from public.document_content_ownership o join public.documents d on d.id=o.document_id
       where o.sha256_hash='dup' order by d.uploaded_at, d.id limit 1`,
    );
    const {
      rows: [earliest],
    } = await db.query(
      `select id from public.documents where sha256_hash='dup' order by uploaded_at, id limit 1`,
    );
    if (o.document_id !== earliest.id) throw new Error("canonical is not the earliest row");
    await db.query(
      `insert into public.documents(tenant_id,case_id,sha256_hash,uploaded_at) values ($1,$2,'dup','2020-01-01T00:00:00+00')`,
      [T, C1],
    );
    bad("dup group extension", "backdated duplicate insert succeeded");
  } catch (e) {
    is23505(e)
      ? ok("pre-existing dups preserved, earliest canonical, backdated extension rejected 23505")
      : bad("pre-existing dups", e);
  }
}

console.log(fail ? `FAILURES: ${fail}` : `ALL ${pass} PASSED`);
if (fail) process.exit(1);

// 7) NULL uploaded_at never wins canonical ownership: a row with unknown
// upload time must not outrank a known-earlier row (explicit NULLS LAST).
{
  const db = new PGlite();
  try {
    await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin;
      create table public.documents(
        id uuid primary key default gen_random_uuid(),
        tenant_id uuid not null, case_id uuid not null,
        name text, file_path text, sha256_hash text,
        uploaded_at timestamptz)`); // deliberately nullable for this case
    // pre-existing duplicates (inserted BEFORE the trigger exists, as on a
    // live DB being repaired): NULL-timestamped and known-timestamped copies
    const known = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
    const unknown = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2";
    await db.query(
      `insert into public.documents (id, tenant_id, case_id, sha256_hash, uploaded_at) values
       ($1,$2,$3,'h-null',NULL), ($4,$2,$3,'h-null','2026-10-01T00:00:00Z')`,
      [unknown, T, C1, known],
    );
    await db.exec(migration);
    const { rows } = await db.query(
      `select document_id from public.document_content_ownership where tenant_id=$1 and case_id=$2 and sha256_hash='h-null'`,
      [T, C1],
    );
    if (rows.length === 1 && rows[0].document_id === known)
      ok("NULL uploaded_at never canonical - known-earlier row wins (NULLS LAST)");
    else bad("NULL uploaded_at canonical", JSON.stringify(rows));
  } catch (e) {
    bad("NULL uploaded_at canonical", e && e.message);
  } finally {
    await db.close();
  }
}
