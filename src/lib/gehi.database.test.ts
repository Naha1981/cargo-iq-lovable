// Local PostgreSQL-backed handler integration. No remote service or app-session claim.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const state = vi.hoisted(() => ({ context: {} as Record<string, unknown> }));
vi.mock("@/lib/auth-middleware", () => ({ tenantMiddleware: {} }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const b = {
      validator: () => b,
      middleware: () => b,
      handler: (fn: (arg: unknown) => unknown) => (arg: { data: unknown }) =>
        fn({ ...arg, context: state.context }),
    };
    return b;
  },
}));
import { createGeospatialFinding, listGeospatialFindings } from "./gehi.functions";
const db = new PGlite();
const A = "11111111-1111-1111-1111-111111111111",
  B = "22222222-2222-2222-2222-222222222222",
  U = "a0000000-0000-0000-0000-000000000001",
  V = "a0000000-0000-0000-0000-000000000002",
  W = "a0000000-0000-0000-0000-000000000003",
  C = "c0000000-0000-0000-0000-000000000001",
  D = "c0000000-0000-0000-0000-000000000002";
// Minimal SDK transport adapter only: filters and changes run against actual RLS/triggers/RPC.
function from(table: string) {
  const allowed = ["geospatial_findings"];
  if (!allowed.includes(table)) throw new Error("Unexpected table");
  const values: unknown[] = [];
  const conditions: string[] = [];
  let inserted: Record<string, unknown> | null = null;
  let order = "";
  const safe = (v: string) => {
    if (!/^[a-z_]+$/.test(v)) throw new Error("Unsafe identifier");
    return '"' + v + '"';
  };
  async function run() {
    try {
      let sql: string;
      if (inserted) {
        const keys = Object.keys(inserted);
        values.push(...Object.values(inserted));
        sql = `insert into public.${table} (${keys.map(safe).join(",")}) values (${keys.map((_, i) => "$" + (i + 1)).join(",")}) returning *`;
      } else
        sql = `select * from public.${table}${conditions.length ? " where " + conditions.join(" and ") : ""}${order}`;
      const r = await db.query(sql, values);
      return { data: r.rows, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }
  const q = {
    select: () => q,
    eq: (column: string, value: unknown) => {
      values.push(value);
      conditions.push(`${safe(column)}=$${values.length}`);
      return q;
    },
    order: (column: string) => {
      order = ` order by ${safe(column)} desc`;
      return q;
    },
    insert: (value: Record<string, unknown>) => {
      inserted = value;
      return q;
    },
    single: async () => {
      const r = await run();
      return { ...r, data: r.data?.[0] ?? null };
    },
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      run().then(resolve, reject),
  };
  return q;
}
const client = {
  from,
  rpc: async () => {
    try {
      const r = await db.query<{ result: unknown }>(
        "select public.cargoiq_integrated_feature_readiness() result",
      );
      return { data: r.rows[0]?.result, error: null };
    } catch (error) {
      return { data: null, error };
    }
  },
};
async function identity(user = U, tenant = A, role = "investigator") {
  await db.exec(`set role authenticated;set app.uid='${user}'`);
  state.context = { supabase: client, tenantId: tenant, user: { id: user }, role };
}
beforeAll(async () => {
  await db.exec(
    `create role authenticated nologin; create role anon nologin;create schema auth;create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid',true),'')::uuid $$;create type public.app_role as enum ('admin','investigator','viewer');create table tenants(id uuid primary key);create table cases(id uuid primary key,tenant_id uuid);create table user_roles(user_id uuid,tenant_id uuid,role public.app_role);create table documents(id uuid primary key,tenant_id uuid,case_id uuid);create table timeline_events(id uuid primary key,tenant_id uuid,case_id uuid);insert into tenants values ('${A}'),('${B}');insert into cases values ('${C}','${A}'),('${D}','${B}');insert into user_roles values ('${U}','${A}','investigator'),('${V}','${A}','viewer'),('${W}','${B}','admin');`,
  );
  for (const p of [
    "supabase/migrations/20261026140000_simulation_lab.sql",
    "supabase/migrations/20261026150000_revenue_recovery.sql",
    "supabase/migrations/20261026160000_scene_gehi.sql",
    "docs/proposals/feature_atomic_audit.sql",
    "docs/proposals/recovery_comparison_batch.sql",
    "docs/proposals/feature_readiness.sql",
  ])
    await db.exec(readFileSync(p, "utf8"));
  await db.exec(
    "grant usage on schema public,auth to authenticated;grant select,insert,update,delete on all tables in schema public to authenticated;",
  );
  await identity();
}, 30000);
afterAll(async () => db.close());
describe("real database GEHI handler journey locally", () => {
  it("validates exact readiness then creates, audits and reloads full manual provenance", async () => {
    expect((await client.rpc()).data).toMatchObject({ ready: true });
    const rationale = JSON.stringify({
      observations: [
        {
          sceneId: "SYNTHETIC-A",
          roi: [
            { x: 0.1, y: 0.1 },
            { x: 0.3, y: 0.1 },
            { x: 0.3, y: 0.3 },
          ],
          coordinateSpace: "normalized_preview_image_not_geographic",
        },
      ],
      review: "SYNTHETIC not verified imagery",
    });
    const row = await createGeospatialFinding({
      data: {
        caseId: C,
        title: "SYNTHETIC manual review",
        source: "SYNTHETIC provider",
        method: "manual, no AI",
        confidence: "unverified",
        rationale,
        latitude: -29.856,
        longitude: 31.041,
      },
    });
    const reloaded = await listGeospatialFindings({ data: { caseId: C } });
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]).toMatchObject({
      id: row.id,
      tenant_id: A,
      case_id: C,
      review_status: "draft",
      rationale,
      created_by: U,
    });
    expect(JSON.parse(reloaded[0].rationale!).observations[0].roi).toHaveLength(3);
    const audit = await db.query<{ actor: string; detail: unknown }>(
      "select actor,detail from geospatial_finding_events where finding_id=$1",
      [row.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].actor).toBe(U);
  });
  it("withholds other tenant rows and refuses mismatched case", async () => {
    await identity(W, B, "admin");
    expect(await listGeospatialFindings({ data: { caseId: C } })).toEqual([]);
    await expect(
      createGeospatialFinding({
        data: {
          caseId: C,
          title: "cross tenant",
          source: "test",
          method: "test",
          confidence: "unverified",
        },
      }),
    ).rejects.toThrow();
    await identity();
  });
  it("refuses viewer writes while allowing same-tenant read", async () => {
    await identity(V, A, "viewer");
    expect(await listGeospatialFindings({ data: { caseId: C } })).toHaveLength(1);
    await expect(
      createGeospatialFinding({
        data: {
          caseId: C,
          title: "viewer",
          source: "test",
          method: "test",
          confidence: "unverified",
        },
      }),
    ).rejects.toThrow("Investigator access required");
    await identity();
  });
  it("fails actual handler closed after safeguard mismatch", async () => {
    await db.exec("reset role;alter table public.geospatial_findings disable row level security;");
    await identity();
    await expect(listGeospatialFindings({ data: { caseId: C } })).rejects.toThrow("not activated");
    await db.exec("reset role;alter table public.geospatial_findings enable row level security;");
    await identity();
    expect((await client.rpc()).data).toMatchObject({ ready: true });
  });
});
