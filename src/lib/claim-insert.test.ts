import { describe, it, expect } from "vitest";
import { insertClaimRow } from "./claim-insert";

function fake(results: any[]) {
  const calls: any[] = [];
  const supabase = { from: () => ({ insert: (row: any) => { calls.push(row); const r = results[calls.length - 1] ?? { data: null, error: { message: "unexpected extra insert" } };
    return { select: () => ({ single: async () => r }) }; } }) };
  return { supabase, calls };
}
const ok = { data: { id: "c1" }, error: null };
describe("insertClaimRow", () => {
  it("one insert with source_seq on success", async () => {
    const f = fake([ok]); const r = await insertClaimRow(f.supabase, { a: 1 }, 3);
    expect(f.calls).toEqual([{ a: 1, source_seq: 3 }]); expect(r.error).toBeNull();
  });
  it("retries once without source_seq only when that column is missing (42703)", async () => {
    const f = fake([{ data: null, error: { code: "42703", message: 'column "source_seq" of relation "extracted_claims" does not exist' } }, ok]);
    const r = await insertClaimRow(f.supabase, { a: 1 }, 2);
    expect(f.calls).toEqual([{ a: 1, source_seq: 2 }, { a: 1 }]); expect(r.error).toBeNull();
  });
  it("retries on PostgREST PGRST204 schema-cache miss for source_seq", async () => {
    const f = fake([{ data: null, error: { code: "PGRST204", message: "Could not find the 'source_seq' column of 'extracted_claims' in the schema cache" } }, ok]);
    await insertClaimRow(f.supabase, { a: 1 }, 1); expect(f.calls.length).toBe(2);
  });
  for (const [name, error] of [
    ["RLS denial", { code: "42501", message: "new row violates row-level security policy" }],
    ["unique violation", { code: "23505", message: "duplicate key value" }],
    ["missing a different column", { code: "42703", message: 'column "nature" does not exist' }],
    ["network error with no code", { message: "fetch failed: source_seq insert timed out" }],
    ["provider-style error", { code: "500", message: "upstream failure" }],
  ] as const) {
    it("does not retry or swallow: " + name, async () => {
      const f = fake([{ data: null, error }, ok]);
      const r = await insertClaimRow(f.supabase, { a: 1 }, 1);
      expect(f.calls.length).toBe(1); expect(r.error).toEqual(error);
    });
  }
  it("returns the second error if the retry also fails", async () => {
    const e2 = { code: "42501", message: "rls" };
    const f = fake([{ data: null, error: { code: "42703", message: "source_seq missing" } }, { data: null, error: e2 }]);
    const r = await insertClaimRow(f.supabase, { a: 1 }, 1); expect(f.calls.length).toBe(2); expect(r.error).toEqual(e2);
  });
});
