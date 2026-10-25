import { describe, expect, it } from "vitest";
import fs from "node:fs";
const source = fs.readFileSync("src/lib/case.functions.ts", "utf8");
const generate = source.slice(
  source.indexOf("export const generateEvidencePack"),
  source.indexOf("export const approveEvidencePack"),
);
const approve = source.slice(
  source.indexOf("export const approveEvidencePack"),
  source.indexOf("export const approveEvidencePack") + 2200,
);
describe("atomic pack server routing", () => {
  it("guards every core POST before doing work, including AI extraction and corroboration", () => {
    const handlers = source
      .split("export const ")
      .filter((x) => x.includes('createServerFn({ method: "POST" })'));
    expect(handlers.length).toBeGreaterThan(5);
    for (const handler of handlers)
      expect(handler).toMatch(
        /handler\(async \(\{ data, context \}\) => \{\s*if \(!\["admin", "investigator"\]\.includes\(context\.role\)\)/,
      );
  });
  it("persists canonical bytes through the atomic RPC without pre-superseding drafts or separate audit", () => {
    expect(generate).toContain('db.rpc("persist_evidence_pack_atomic"');
    expect(generate).toContain("_canonical: stableCanonical(payload)");
    expect(generate).not.toContain('db.from("evidence_packs").update');
    expect(generate).not.toContain('db.from("evidence_packs").insert');
    expect(generate).not.toContain('db.from("audit_log").insert');
    expect(generate).toContain("if (persistError) throw persistError");
  });
  it("approves through one RPC, leaving case status and audit in its transaction", () => {
    expect(approve).toContain('.rpc("approve_evidence_pack_atomic"');
    expect(approve).not.toContain('.from("evidence_packs").update');
    expect(approve).not.toContain('.from("cases").update');
    expect(approve).not.toContain('.from("audit_log").insert');
  });
});
describe("on-demand pack payload", () => {
  const onDemand = source.slice(
    source.indexOf("export const getEvidencePackPayload"),
    source.indexOf("export const getEvidencePackPayload") + 1200,
  );
  it("keeps heavy payloads out of the workspace load", () => {
    const flatSource = source.replace(/\s+/g, "");
    expect(flatSource).toContain(
      'from("evidence_packs").select("id,version,sha256_hash,status,approved_by,generated_at")',
    );
    expect(onDemand.replace(/\s+/g, "")).toContain(
      'select("id,case_id,version,sha256_hash,status,approved_by,generated_at,pack_payload")',
    );
  });
  it("scopes the payload fetch to the caller's tenant and one pack", () => {
    expect(onDemand).toContain('.eq("id", data.packId)');
    expect(onDemand).toContain('.eq("tenant_id", context.tenantId)');
    expect(onDemand).toContain(".maybeSingle()");
  });
});
