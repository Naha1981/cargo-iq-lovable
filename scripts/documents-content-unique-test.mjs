// PGlite test for 20261025230000_documents_content_unique.sql (unique upload
// object ownership). Proves: duplicate guard fails loudly, index blocks a
// concurrent same-content insert (23505), different case/hash still allowed,
// NULL hashes never collide, deleted rows free the content.
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
const C1 = "22222222-2222-2222-2222-222222222222";
const C2 = "33333333-3333-3333-3333-333333333333";
const migration = readFileSync(
  new URL("../supabase/migrations/20261025230000_documents_content_unique.sql", import.meta.url),
  "utf8",
);
const newDb = async () => {
  const db = new PGlite();
  await db.exec(`create table public.documents(
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null, case_id uuid not null,
    name text, file_path text, sha256_hash text, created_at timestamptz default now())`);
  return db;
};

// 1) Pre-existing duplicates: migration must fail loudly, not dedupe silently.
try {
  const db = await newDb();
  await db.query(
    `insert into public.documents(tenant_id,case_id,sha256_hash) values ($1,$2,'aaa'),($1,$2,'aaa')`,
    [T, C1],
  );
  await db.exec(migration);
  bad("duplicate guard", "migration applied over duplicates");
} catch (e) {
  /live duplicate/.test(String(e))
    ? ok("pre-existing duplicates: migration fails loudly, nothing deduped silently")
    : bad("duplicate guard", e);
}

const db = await newDb();
await db.exec(migration);
// 2) Index exists after a clean apply.
try {
  const { rows } = await db.query(
    `select indexdef from pg_indexes where indexname = 'documents_tenant_case_sha256_uniq'`,
  );
  if (rows.length !== 1 || !/WHERE \(sha256_hash IS NOT NULL\)/.test(rows[0].indexdef))
    throw new Error("index missing or not partial: " + JSON.stringify(rows));
  ok("clean apply creates the partial unique index");
} catch (e) {
  bad("index exists", e);
}
// 3) Same tenant+case+content twice: second insert is 23505.
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
  /23505|duplicate key/.test(String(e))
    ? ok(
        "same tenant+case+content twice: second insert rejected (23505) - race closed by the database",
      )
    : bad("race closed", e);
}
// 4) Different case or different content still allowed.
try {
  await db.query(
    `insert into public.documents(tenant_id,case_id,sha256_hash) values ($1,$2,'aaa')`,
    [T, C2],
  );
  await db.query(
    `insert into public.documents(tenant_id,case_id,sha256_hash) values ($1,$2,'bbb')`,
    [T, C1],
  );
  ok("same content in another case, and other content in the same case, both allowed");
} catch (e) {
  bad("allowed non-duplicates", e);
}
// 5) NULL hashes never collide (rows predating hashing).
try {
  await db.query(
    `insert into public.documents(tenant_id,case_id,sha256_hash) values ($1,$2,NULL),($1,$2,NULL)`,
    [T, C1],
  );
  ok("NULL hashes never collide");
} catch (e) {
  bad("NULL hashes", e);
}
// 6) Deleting the row frees the content for re-upload.
try {
  await db.query(
    `delete from public.documents where tenant_id=$1 and case_id=$2 and sha256_hash='aaa'`,
    [T, C1],
  );
  await db.query(
    `insert into public.documents(tenant_id,case_id,sha256_hash) values ($1,$2,'aaa')`,
    [T, C1],
  );
  ok("deleting the row frees the content for re-upload");
} catch (e) {
  bad("delete frees content", e);
}
console.log(fail ? `FAIL (${fail} failing, ${pass} passing)` : `ALL ${pass} CHECKS PASS`);
process.exit(fail ? 1 : 0);
