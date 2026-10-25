// PGlite test for 20261024216000_app_errors_bounds.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const db = new PGlite();
await db.exec(
  `create table public.app_errors (id uuid primary key default gen_random_uuid(), user_id uuid, route text, source text, message text, stack text, created_at timestamptz not null default now());`,
);
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
const sql = readFileSync(
  new URL("../supabase/migrations/20261024216000_app_errors_bounds.sql", import.meta.url),
  "utf8",
);
try {
  await db.exec(sql);
  ok("apply");
} catch (e) {
  bad("apply", e.message);
}
try {
  await db.exec(sql);
  ok("re-apply no-op");
} catch (e) {
  bad("re-apply no-op", e.message);
}
const ins = (m, s2) =>
  db.query(
    `insert into public.app_errors(route, source, message, stack) values ('/x','client',$1,$2)`,
    [m, s2],
  );
try {
  await ins("x".repeat(4000), "y".repeat(8000));
  ok("boundary-length insert");
} catch (e) {
  bad("boundary-length insert", e.message);
}
try {
  await ins("x".repeat(4001), null);
  bad("oversized message rejected", "succeeded");
} catch (e) {
  ok("oversized message rejected");
}
try {
  await ins("ok", "y".repeat(8001));
  bad("oversized stack rejected", "succeeded");
} catch (e) {
  ok("oversized stack rejected");
}
console.log(`APP_ERRORS: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
