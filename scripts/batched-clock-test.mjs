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
const db = new PGlite();
await db.query("create role authenticated nologin");
await db.query("create role anon nologin");
await db.exec(`
  create table public.operational_clocks(id uuid primary key default gen_random_uuid(), case_id uuid, physical_reference text, kind text, occurred_at timestamptz);
  create table public.clock_reconciliations(id uuid primary key default gen_random_uuid(), case_id uuid, physical_reference text, kind text, version int, considered_clock_ids uuid[]);
`);
// original per-case function (from 20261015171000) for equivalence reference
await db.exec(`
  CREATE FUNCTION public.has_unresolved_operational_clocks(_case_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$
   SELECT EXISTS(
    SELECT 1 FROM (SELECT physical_reference,kind,array_agg(id ORDER BY id) AS ids,count(DISTINCT occurred_at) AS timestamps FROM public.operational_clocks WHERE case_id=_case_id GROUP BY physical_reference,kind) g
    LEFT JOIN LATERAL(SELECT * FROM public.clock_reconciliations r WHERE r.case_id=_case_id AND r.physical_reference=g.physical_reference AND r.kind=g.kind ORDER BY version DESC LIMIT 1) d ON true
    WHERE g.timestamps>1 AND (d.id IS NULL OR d.considered_clock_ids IS DISTINCT FROM g.ids))
  $f$;
`);
const mig = readFileSync("supabase/migrations/20261024214000_batched_clock_check.sql", "utf8");
const C1 = "11111111-1111-4111-8111-111111111111",
  C2 = "22222222-2222-4222-8222-222222222222",
  C3 = "33333333-3333-4333-8333-333333333333",
  C4 = "44444444-4444-4444-8444-444444444444";
await db.exec(mig);
// C1: two conflicting clocks, no reconciliation -> blocked
await db.query(
  "insert into public.operational_clocks(case_id,physical_reference,kind,occurred_at) values ($1,'CNT-1','GATE_IN','2026-10-01 08:00'),($1,'CNT-1','GATE_IN','2026-10-01 09:30')",
  [C1],
);
// C2: conflict but reconciled at latest version covering exactly the current ids -> clear
await db.query(
  "insert into public.operational_clocks(case_id,physical_reference,kind,occurred_at) values ($1,'CNT-2','GATE_IN','2026-10-01 08:00'),($1,'CNT-2','GATE_IN','2026-10-01 09:30')",
  [C2],
);
const ids2 = (
  await db.query(
    "select array_agg(id order by id) a from public.operational_clocks where case_id=$1",
    [C2],
  )
).rows[0].a;
await db.query(
  "insert into public.clock_reconciliations(case_id,physical_reference,kind,version,considered_clock_ids) values ($1,'CNT-2','GATE_IN',1,$2)",
  [C2, ids2],
);
// C3: conflict, reconciliation exists but STALE (a third clock arrived after) -> blocked
await db.query(
  "insert into public.operational_clocks(case_id,physical_reference,kind,occurred_at) values ($1,'CNT-3','GATE_IN','2026-10-01 08:00'),($1,'CNT-3','GATE_IN','2026-10-01 09:30')",
  [C3],
);
const ids3partial = (
  await db.query(
    "select array_agg(id order by id) a from public.operational_clocks where case_id=$1",
    [C3],
  )
).rows[0].a;
await db.query(
  "insert into public.clock_reconciliations(case_id,physical_reference,kind,version,considered_clock_ids) values ($1,'CNT-3','GATE_IN',1,$2)",
  [C3, ids3partial],
);
await db.query(
  "insert into public.operational_clocks(case_id,physical_reference,kind,occurred_at) values ($1,'CNT-3','GATE_IN','2026-10-01 10:00')",
  [C3],
);
// C4: single clock only -> clear
await db.query(
  "insert into public.operational_clocks(case_id,physical_reference,kind,occurred_at) values ($1,'CNT-4','GATE_IN','2026-10-01 08:00')",
  [C4],
);

const all = [C1, C2, C3, C4];
const batched = new Set(
  (
    await db.query("select public.cases_with_unresolved_operational_clocks($1) as id", [all])
  ).rows.map((r) => r.id),
);
let equiv = true;
for (const c of all) {
  const single = (await db.query("select public.has_unresolved_operational_clocks($1) b", [c]))
    .rows[0].b;
  if (batched.has(c) !== single) {
    equiv = false;
    bad("equivalence case " + c.slice(0, 8), `single=${single} batched=${batched.has(c)}`);
  }
}
equiv &&
  ok(
    "batched == per-case across 4 scenarios (unresolved/reconciled/stale-reconciliation/single-clock)",
  );
batched.has(C1) && !batched.has(C2) && batched.has(C3) && !batched.has(C4)
  ? ok("expected blocked set {C1,C3} exactly")
  : bad("blocked set", JSON.stringify([...batched]));
const empty = (
  await db.query("select public.cases_with_unresolved_operational_clocks('{}'::uuid[]) as id")
).rows.length;
empty === 0 ? ok("empty input -> empty result") : bad("empty input", String(empty));
console.log(fail === 0 ? `ALL ${pass} PASS` : `${fail} FAILURES`);
