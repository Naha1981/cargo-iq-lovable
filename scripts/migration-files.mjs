// Canonical two-layer migration inventory. The four generated Drizzle copies
// arrived after their canonical Supabase SQL. Replaying both creates tables twice.
// Exact copy hashes fail closed if these artifacts change; no SQL is edited.
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const mirroredArtifacts = new Map([
  [
    "drizzle/migrations/0002_claim_source_order.sql",
    {
      mirrorHash: "b63ef78433a363f77ffc24954fddd45f68a5f4355f59fd5de970b39b7887ba73",
      canonical: "supabase/migrations/20261021010000_claim_source_order.sql",
      canonicalHash: "732b6212e402cb4fb46e7c39e274c74d9b12f6fdd2f97ad0b62ae455e00610b0",
    },
  ],
  [
    "drizzle/migrations/0003_admin_ai_health.sql",
    {
      mirrorHash: "c58d29ea08bf2a651c97516c45c609c6db492f6068fd89f860a27b191e4f5e90",
      canonical: "supabase/migrations/20261025210000_admin_ai_health.sql",
      canonicalHash: "d647052e5b5d5399bb70d713c7a89c3f6440fea0b2cf9e072d975e9cfe13d936",
    },
  ],
  [
    "drizzle/migrations/0004_health_email_day_claim.sql",
    {
      mirrorHash: "1b8d52b5100a6c29d7c479d1fbbed375252387bd0a3afdee0ef7ecca2ca3ba87",
      canonical: "supabase/migrations/20261025240000_health_email_day_claim.sql",
      canonicalHash: "26a795909f543759b36e4dee3dd962f8ccaeed7a4205e568c1d2c5fff6df93f7",
    },
  ],
  [
    "drizzle/migrations/0005_whatsapp_quote_foundation.sql",
    {
      mirrorHash: "b82351febb3901539d33c2abee9c72e0d84cbfd99b128b2a79ffe5fec36c1f4b",
      canonical: "supabase/migrations/20261016054000_whatsapp_quote_foundation.sql",
      canonicalHash: "0c920f5bbe59f60dd66e4df6f4bcff4887c29eb5fcb2a9f439bd0733f10666ad",
    },
  ],
]);
export function migrationFiles() {
  return ["drizzle/migrations", "supabase/migrations"]
    .flatMap((dir) =>
      readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort()
        .map((f) => `${dir}/${f}`),
    )
    .filter((file) => {
      if (!mirroredArtifacts.has(file)) return true;
      const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
      const reviewed = mirroredArtifacts.get(file);
      const canonicalHash = createHash("sha256")
        .update(readFileSync(reviewed.canonical))
        .digest("hex");
      if (hash !== reviewed.mirrorHash || canonicalHash !== reviewed.canonicalHash)
        throw new Error(`MIRRORED_MIGRATION_DRIFT: ${file}`);
      return false;
    });
}
