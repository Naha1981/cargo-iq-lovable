import assert from "node:assert/strict";
import { migrationFiles } from "./migration-files.mjs";
const files = migrationFiles();
assert.equal(files.length, new Set(files).size);
assert(files.includes("drizzle/migrations/0000_cargoiq_core.sql"));
assert(files.includes("drizzle/migrations/0001_case_documents_policies.sql"));
assert(!files.some((f) => /drizzle\/migrations\/000[2-5]_/.test(f)));
assert(files.includes("supabase/migrations/20261016054000_whatsapp_quote_foundation.sql"));
assert(files.includes("supabase/migrations/20261102053000_dd_case_draft.sql"));
console.log(
  "PASS canonical migration inventory excludes four exact mirrored artifacts, retains base and approved draft",
);

// Adversarial replay copies are temporary. Never edit repository migrations.
import { mkdtempSync, mkdirSync, copyFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const root = process.cwd();
const temp = mkdtempSync(join(tmpdir(), "cargo-migration-inventory-"));
try {
  for (const dir of ["drizzle/migrations", "supabase/migrations"])
    mkdirSync(join(temp, dir), { recursive: true });
  for (const name of [
    "0002_claim_source_order.sql",
    "0003_admin_ai_health.sql",
    "0004_health_email_day_claim.sql",
    "0005_whatsapp_quote_foundation.sql",
  ])
    copyFileSync(join(root, "drizzle/migrations", name), join(temp, "drizzle/migrations", name));
  for (const name of [
    "20261021010000_claim_source_order.sql",
    "20261025210000_admin_ai_health.sql",
    "20261025240000_health_email_day_claim.sql",
    "20261016054000_whatsapp_quote_foundation.sql",
  ])
    copyFileSync(join(root, "supabase/migrations", name), join(temp, "supabase/migrations", name));
  process.chdir(temp);
  assert.equal(migrationFiles().length, 4);
  appendFileSync("drizzle/migrations/0002_claim_source_order.sql", "-- drift");
  assert.throws(() => migrationFiles(), /MIRRORED_MIGRATION_DRIFT/);
  copyFileSync(
    join(root, "drizzle/migrations/0002_claim_source_order.sql"),
    "drizzle/migrations/0002_claim_source_order.sql",
  );
  appendFileSync("supabase/migrations/20261021010000_claim_source_order.sql", "-- drift");
  assert.throws(() => migrationFiles(), /MIRRORED_MIGRATION_DRIFT/);
  console.log("PASS mirror or canonical checksum drift refuses replay");
} finally {
  process.chdir(root);
  rmSync(temp, { recursive: true, force: true });
}
