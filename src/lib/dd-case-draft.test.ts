import { describe, it, expect } from "vitest";
import { ddCaseDraftSchema, emptyDdCaseDraft } from "./dd-case-draft";
import { readFileSync } from "node:fs";
describe("case draft validation and SQL safeguards", () => {
  it("accepts an empty editable draft but bounds input sizes and evidence statuses", () => {
    expect(ddCaseDraftSchema.parse(emptyDdCaseDraft())).toEqual(emptyDdCaseDraft());
    expect(
      ddCaseDraftSchema.safeParse({ ...emptyDdCaseDraft(), containerNo: "x".repeat(2001) }).success,
    ).toBe(false);
    expect(
      ddCaseDraftSchema.safeParse({ ...emptyDdCaseDraft(), ledger: Array(101).fill({}) }).success,
    ).toBe(false);
  });
  it("keeps the migration invoker-scoped, tenant-role checked and revision locked", () => {
    const sql = readFileSync("supabase/migrations/20261102053000_dd_case_draft.sql", "utf8");
    expect(sql).toContain("security invoker");
    expect(sql).not.toContain("security definer");
    expect(sql).toContain("r.tenant_id = cases.tenant_id");
    expect(sql).toContain("r.user_id = auth.uid()");
    expect(sql).toContain("r.role in ('admin', 'investigator')");
    expect(sql).toContain("for update");
    expect(sql).toContain("DRAFT_CONFLICT");
    expect(sql).toContain("from public, anon");
  });
});
