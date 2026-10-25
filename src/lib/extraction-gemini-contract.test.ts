import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

type FakeRow = Record<string, unknown>;
type RpcArgs = Record<string, unknown>;
import fs from "node:fs";
import { Blob } from "node:buffer";
import {
  chunkPages,
  extractDocumentClaimsForPath,
  geminiTestModel,
  parseDiscrepancies,
  timestampConflict,
} from "./extraction.functions";
import { buildEvidencePackPdf } from "./pack-pdf";

const keys = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "LOVABLE_API_KEY",
  "CLAIM_AI_PROVIDER",
  "GEMINI_API_KEY",
  "CLAIM_GEMINI_TEST_FALLBACK_ENABLED",
  "CLAIM_GEMINI_FREE_TIER_CONFIRMED",
  "CLAIM_GEMINI_TEST_MODEL",
];
const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
function db(blob: Blob, name: string, type: string) {
  const inserted: FakeRow[] = [];
  const audits: FakeRow[] = [];
  const docUpdates: FakeRow[] = [];
  const supabase = {
    storage: { from: () => ({ download: async () => ({ data: blob, error: null }) }) },
    rpc: async (fn: string, args: RpcArgs) => {
      // Emulates migrations 20261024217000 + 20261024221000 applied.
      if (fn === "reserve_free_extraction_attempt") return { data: "reserved", error: null };
      if (fn !== "replace_pending_claims")
        return { data: null, error: { code: "PGRST202", message: "missing" } };
      const rows: FakeRow[] = (args._claims as FakeRow[]).map((c, i) => ({
        id: "claim-" + (inserted.length + i + 1),
        status: "PENDING",
        ...c,
      }));
      inserted.push(...rows);
      return { data: rows.map((r) => ({ id: r.id, claim_text: r.claim_text })), error: null };
    },
    from(table: string) {
      const q = {
        data: [],
        error: null,
        eq: () => q,
        select: () => q,
        update: (row: FakeRow) => {
          if (table === "documents") docUpdates.push(row);
          return q;
        },
        single: async () => ({
          data:
            table === "documents"
              ? { name, file_type: type, file_path: "synthetic/test" }
              : { id: "r" + inserted.length },
          error: null,
        }),
        insert: (row: FakeRow) => {
          if (table === "extracted_claims") inserted.push(row);
          if (table === "audit_log") audits.push(row);
          return q;
        },
      };
      return q;
    },
  };
  return { supabase, inserted, audits, docUpdates };
}
const base = { documentId: "d", caseId: "c", tenantId: "t", userId: "u" };
function gates() {
  for (const k of keys) delete process.env[k];
  process.env.GEMINI_API_KEY = "synthetic";
  process.env.CLAIM_GEMINI_TEST_FALLBACK_ENABLED = "true";
  process.env.CLAIM_GEMINI_FREE_TIER_CONFIRMED = "true";
}
const ok = (claims: FakeRow[]) =>
  new Response(
    JSON.stringify({
      candidates: [
        { finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ claims }) }] } },
      ],
    }),
    { status: 200 },
  );

describe("free Gemini test path contract", () => {
  it("uses a configurable model that defaults to a supported alias, never a dated retired name", () => {
    delete process.env.CLAIM_GEMINI_TEST_MODEL;
    expect(geminiTestModel()).toBe("gemini-flash-lite-latest");
    process.env.CLAIM_GEMINI_TEST_MODEL = "models/gemini-x";
    expect(geminiTestModel()).toBe("gemini-x");
  });
  it("a model that answers with the wrong field names is reported, not silently turned into raw text", async () => {
    gates();
    const wrong = new Response(
      JSON.stringify({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    claims: [{ statement: "Gate out 2 Oct", date: "2026-10-02" }],
                  }),
                },
              ],
            },
          },
        ],
      }),
      { status: 200 },
    );
    // primary provider fails (no key) -> free path; both the first call and its single retry are not retried for shape errors
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => wrong.clone()),
    );
    const mock = db(new Blob(["Gate out 2 Oct"]), "t.txt", "text/plain");
    const out = await extractDocumentClaimsForPath({
      ...base,
      supabase: mock.supabase as unknown as SupabaseClient,
      freeDataClass: "public_synthetic" as const,
    });
    expect(out.mode).toBe("text-fallback");
    expect(out.providerUsed).toBe("none");
    expect((out as { fallbackErrors?: string[] }).fallbackErrors?.[0]).toContain(
      "EXTRACTION_SCHEMA_MISMATCH",
    );
    expect((mock.audits[0].payload as { fallbackErrors: string[] }).fallbackErrors[0]).toContain(
      "EXTRACTION_SCHEMA_MISMATCH",
    );
  });
  it("a truncated model answer is rejected, never accepted as a complete chunk", async () => {
    gates();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              candidates: [
                { finishReason: "MAX_TOKENS", content: { parts: [{ text: '{"claims":[{' }] } },
              ],
            }),
            { status: 200 },
          ),
      ),
    );
    const mock = db(new Blob(["x"]), "t.txt", "text/plain");
    const out = await extractDocumentClaimsForPath({
      ...base,
      supabase: mock.supabase as unknown as SupabaseClient,
      freeDataClass: "public_synthetic" as const,
    });
    expect(out.providerUsed).toBe("none");
    expect((out as { fallbackErrors?: string[] }).fallbackErrors?.[0]).toContain(
      "FINISH_MAX_TOKENS",
    );
  });
  it("a text PDF is sent as page-tagged sections with the claim schema enforced", async () => {
    gates();
    const fetch = vi.fn(async () =>
      ok([
        {
          page_number: 1,
          claim_text: "The court found X.",
          claim_type: "finding",
          value: "",
          evidence_class: "OFFICIAL_PUBLIC",
          nature: "OBSERVED",
          confidence: 0.9,
          timestamp_claimed: "",
          event_reference: "",
        },
      ]),
    );
    vi.stubGlobal("fetch", fetch);
    const mock = db(
      new Blob([fs.readFileSync("tests/fixtures/synthetic-recovery.pdf")]),
      "t.pdf",
      "application/pdf",
    );
    const out = await extractDocumentClaimsForPath({
      ...base,
      supabase: mock.supabase as unknown as SupabaseClient,
      freeDataClass: "public_synthetic" as const,
    });
    expect(out.providerUsed).toBe("gemini-test");
    expect(out.count).toBeGreaterThan(0);
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.generationConfig.responseSchema.properties.claims.items.required).toContain(
      "claim_text",
    );
  });
});

describe("chunking", () => {
  it("keeps page tags, covers every page, and splits an oversized page without losing lines", () => {
    const pages = ["a\nb", "c".repeat(30) + "\n" + "d".repeat(30), "e"];
    const chunks = chunkPages(pages, 60);
    const joined = chunks.join("");
    for (const t of ["[page 1]", "[page 2", "[page 3]"]) expect(joined).toContain(t);
    expect(joined).toContain("c".repeat(30));
    expect(joined).toContain("d".repeat(30));
    expect(chunks.every((c) => c.length <= 90)).toBe(true);
  });
});

describe("timestamp conflicts", () => {
  const mk = (type: string, ref: string, ts: string) => ({
    claim_text: "x",
    claim_type: type,
    event_reference: ref,
    timestamp_claimed: ts,
    evidence_class: "X",
    nature: "REPORTED" as const,
  });
  it("flags the same explicitly identified event with different times", () => {
    expect(
      timestampConflict(
        mk("gate_out", "VISIT-884", "2026-10-02T08:00:00Z"),
        mk("gate_out", "VISIT-884", "2026-10-03T08:00:00Z"),
      ),
    ).toContain("24 hour");
  });
  it("never flags separate payments or a reused container number", () => {
    expect(
      timestampConflict(
        mk("payment_entry", "VISIT-1", "2022-08-18T00:00:00Z"),
        mk("payment_entry", "VISIT-1", "2022-08-22T00:00:00Z"),
      ),
    ).toBeNull();
    expect(
      timestampConflict(
        mk("gate_out", "FCIU5190259", "2022-08-18T00:00:00Z"),
        mk("gate_out", "FCIU5190259", "2022-08-22T00:00:00Z"),
      ),
    ).toBeNull();
  });
});

describe("discrepancy pass validation", () => {
  it("keeps only flags that cite two real, different claims with an explanation", () => {
    const text = JSON.stringify({
      discrepancies: [
        { claim_a: 1, claim_b: 2, kind: "DIFFERENT_FIGURES", explanation: "73 vs 83 containers" },
        { claim_a: 1, claim_b: 1, explanation: "self" },
        { claim_a: 1, claim_b: 99, explanation: "out of range" },
        { claim_a: 2, claim_b: 1, explanation: "duplicate pair" },
        { claim_a: 2, claim_b: 3, explanation: "" },
      ],
    });
    const out = parseDiscrepancies(text, 3);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ a: 1, b: 2 });
  });
});

describe("evidence pack layout and labels", () => {
  const claim = (i: number) => ({
    id: "c" + i,
    document_id: "d1",
    page_number: 1,
    claim_text: "Claim " + i + " " + "word ".repeat(18),
    status: "PENDING",
    nature: "REPORTED",
    confidence: 0.55,
  });
  const pack = (status: string) => ({
    version: 1,
    status,
    sha256_hash: "a".repeat(64),
    generated_at: "2026-10-12T10:00:00Z",
    approved_by: null,
    pack_payload: {
      generatedAt: "2026-10-12T10:00:00Z",
      case: { reference_no: "R", counterparty: "C" },
      documents: [{ id: "d1", name: "Doc.pdf", sha256_hash: "b".repeat(64) }] as FakeRow[],
      timeline: [] as { timestamp: string; nature: string; title: string; source: string }[],
      claims: Array.from({ length: 90 }, (_, i) => claim(i)),
      contradictions: [] as FakeRow[],
      financialCalculations: [] as FakeRow[],
      externalObservations: [] as FakeRow[],
    },
  });
  const pages = (bytes: Uint8Array) =>
    Buffer.from(bytes)
      .toString("latin1")
      .split("stream")
      .filter((_, i) => i % 2 === 1);
  it("never starts a page with an orphaned source line", () => {
    const ps = pages(buildEvidencePackPdf(pack("DRAFT")));
    expect(ps.length).toBeGreaterThan(2);
    for (const p of ps) {
      const first = (p.match(/\(((?:[^()\\]|\\.)*)\) Tj/) ?? [])[1] ?? "";
      expect(first.startsWith("Source:")).toBe(false);
    }
  });
  it("keeps each timeline entry whole on one page", () => {
    const pk = pack("DRAFT");
    pk.pack_payload.timeline = Array.from({ length: 80 }, (_, i) => ({
      timestamp: "2013-02-01T00:00:00Z",
      nature: "OBSERVED",
      title: "Event " + i + " " + "word ".repeat(30),
      source: "Doc.pdf",
    }));
    const ps = pages(buildEvidencePackPdf(pk));
    for (const p of ps) {
      const first = (p.match(/\(((?:[^()\\]|\\.)*)\) Tj/) ?? [])[1] ?? "";
      expect(first.startsWith("Event")).toBe(false);
      expect(first.includes("- Source:")).toBe(false);
    }
  });
  it("real packs always say canonical (the database hashes the canonical payload at generation); test files say TEST HASH inside the file", () => {
    const real = Buffer.from(buildEvidencePackPdf(pack("DRAFT"))).toString("latin1");
    expect(real).toContain("canonical pack payload");
    expect(real).not.toContain("TEST HASH");
    expect(real).not.toContain("AIS can contain");
    expect(real).toContain("document claims and raw imported source lines only");
    const t = Buffer.from(buildEvidencePackPdf({ ...pack("DRAFT"), test_hash: true })).toString(
      "latin1",
    );
    expect(t).toContain("TEST HASH - NOT A CARGOIQ HASH");
    expect(t).toContain("TEST HASH \\(not a seal\\)");
    expect(t).not.toContain("canonical pack payload:");
  });
  it("orders the timeline chronologically and does not present a date-only value as a known midnight", () => {
    const pk = pack("DRAFT");
    pk.pack_payload.timeline = [
      { timestamp: "2025-07-14T00:00:00.000Z", nature: "REPORTED", title: "LATE", source: "d" },
      { timestamp: "2022-08-09T00:00:00.000Z", nature: "OBSERVED", title: "EARLY", source: "d" },
      { timestamp: "2022-08-09T10:30:00.000Z", nature: "OBSERVED", title: "TIMED", source: "d" },
    ];
    const txt = Buffer.from(buildEvidencePackPdf(pk)).toString("latin1");
    expect(txt.indexOf("EARLY")).toBeLessThan(txt.indexOf("TIMED"));
    expect(txt.indexOf("TIMED")).toBeLessThan(txt.indexOf("LATE"));
    expect(txt).toContain("2022-08-09 \\(time not stated\\)");
    expect(txt).toContain("2022-08-09 10:30Z");
    expect(txt).not.toContain("00:00Z");
  });
  it("extraction completeness and discrepancy-review coverage are reported separately", () => {
    const mk = (status: string) => {
      const pk = pack("DRAFT");
      pk.pack_payload.documents = [
        { id: "d1", name: "Doc.pdf", sha256_hash: "abc", extraction_status: status },
      ];
      pk.pack_payload.contradictions = [];
      return Buffer.from(buildEvidencePackPdf(pk)).toString("latin1");
    };
    const partial = mk("EXTRACTED_INCOMPLETE|REVIEW:MODEL_RAN|NOTE:chunk 3 failed");
    expect(partial).toContain("EXTRACTION INCOMPLETE");
    expect(partial).toContain("chunk 3 failed");
    expect(partial).toContain("not a finding of none");
    const noReview = mk("EXTRACTED|REVIEW:MODEL_NOT_RUN");
    expect(noReview).not.toContain("EXTRACTION INCOMPLETE");
    expect(noReview).toContain("optional model check not run");
    expect(noReview).toContain("not a finding of none");
    const failed = mk("EXTRACTED|REVIEW:MODEL_FAILED");
    expect(failed).not.toContain("EXTRACTION INCOMPLETE");
    expect(failed).toContain("FAILED");
    const ok = mk("EXTRACTED|REVIEW:MODEL_RAN");
    expect(ok).toContain("flagged by these checks");
    expect(ok).toContain("not proof that none exist");
    expect(ok).not.toContain("not a finding of none");
    for (const legacy of ["PENDING", "", "COMPLETE"]) {
      const u = mk(legacy);
      expect(u).toContain("EXTRACTION STATUS NOT RECORDED");
      expect(u).toContain("not a finding of none");
    }
  });
});

describe("coverage audit", () => {
  it("reports a container ID that is in the source but in no claim, ignoring spacing and case", async () => {
    const { missingContainerIds } = await import("./extraction.functions");
    const pages = [
      "Entry 1 BEAU6225110 paid 825\nEntry 3 CSNU8457610 paid 825\nMedu 3033700 note",
      "no ids here",
    ];
    const claims = [
      { claim_text: "Paid USD 825 for container BEAU6225110" },
      { claim_text: "Container MEDU 3033700 was lost" },
    ];
    expect(missingContainerIds(pages, claims)).toEqual([
      { id: "CSNU8457610", page: 1, lines: ["Entry 3 CSNU8457610 paid 825"] },
    ]);
    expect(missingContainerIds(pages, [...claims, { claim_text: "csnu 8457610 paid" }])).toEqual(
      [],
    );
  });
});

describe("dedupe keeps distinct identifiers", () => {
  it("does not merge two payment rows that differ only by container and line reference", async () => {
    const { isSemanticDuplicate } = await import("./extraction.functions");
    const a =
      "The payment schedule reports payment date 2022-08-09 for container CSNU8330251 with COSCO line reference 6336422960 and amount USD 825.00.";
    const b =
      "The payment schedule reports payment date 2022-08-09 for container CSNU8457610 with COSCO line reference 6336422770 and amount USD 825.00.";
    expect(isSemanticDuplicate(a, b)).toBe(false);
    expect(
      isSemanticDuplicate(
        a,
        "The payment schedule reports a payment date of 2022-08-09 for container CSNU8330251, COSCO line reference 6336422960, amount USD 825.00.",
      ),
    ).toBe(true);
  });
});

describe("day-precision guard", () => {
  it("keeps a timestamp only when the claim states the day", async () => {
    const { dayAnchored } = await import("./extraction.functions");
    expect(dayAnchored("The warrant was issued on 1 February 2013.", "2013-02-01T00:00:00Z")).toBe(
      true,
    );
    expect(dayAnchored("Arrest on February 1, 2013", "2013-02-01")).toBe(true);
    expect(dayAnchored("Paid 2022-08-09 for container X", "2022-08-09T00:00:00Z")).toBe(true);
    expect(dayAnchored("Delivered in February 2014.", "2014-02-01T00:00:00Z")).toBe(false);
    expect(dayAnchored("IT manager in 2012/2013.", "2012-01-01T00:00:00Z")).toBe(false);
    expect(dayAnchored("Released on 8 February.", "2013-02-07T00:00:00Z")).toBe(false);
  });
});
