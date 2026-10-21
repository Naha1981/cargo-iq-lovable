import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { Blob } from "node:buffer";
import { enabledFreeFallbacks, extractDocumentClaimsForPath } from "./extraction.functions";
const envKeys = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "LOVABLE_API_KEY", "CLAIM_AI_PROVIDER", "GEMINI_API_KEY", "CLAIM_GEMINI_TEST_FALLBACK_ENABLED", "CLAIM_GEMINI_FREE_TIER_CONFIRMED", "OPENROUTER_API_KEY", "CLAIM_OPENROUTER_FREE_FALLBACK_ENABLED", "GROQ_API_KEY", "CLAIM_GROQ_FREE_PLAN_CONFIRMED"];
const saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
afterEach(() => { vi.unstubAllGlobals(); for (const key of envKeys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
function clear() { for (const key of envKeys) delete process.env[key]; }
function db(blob: Blob, name: string, type: string) {
  const inserted: any[] = [];
  const supabase = {
    storage: { from: () => ({ download: async () => ({ data: blob, error: null }) }) },
    from(table: string) {
      const query: any = { data: [], error: null, eq: () => query, select: () => query,
        single: async () => ({ data: table === "documents" ? { name, file_type: type, file_path: "synthetic/test" } : { id: "claim-" + inserted.length }, error: null }),
        insert: (row: any) => { if (table === "extracted_claims") inserted.push(row); return query; },
      };
      return query;
    },
  };
  return { supabase: supabase as any, inserted };
}
const base = { documentId: "synthetic-doc", caseId: "synthetic-case", tenantId: "synthetic-tenant", userId: "synthetic-user" };
describe("bounded extraction recovery", () => {
  it("no-AI text import never calls any provider", async () => {
    clear(); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const mock = db(new Blob(["gate in\ngate out"]), "test.txt", "text/plain");
    const result = await extractDocumentClaimsForPath({ ...base, supabase: mock.supabase, noAi: true });
    expect(fetch).not.toHaveBeenCalled(); expect(result.mode).toBe("text"); expect(result.count).toBe(2);
    expect(mock.inserted.every(row => row.nature === "REPORTED" && row.timestamp_claimed == null)).toBe(true);
  });
  it("402 imports real PDF text with page provenance and no invented timestamps", async () => {
    clear(); process.env.LOVABLE_API_KEY = "synthetic-key";
    const fetch = vi.fn(async () => new Response("quota", { status: 402 })); vi.stubGlobal("fetch", fetch);
    const mock = db(new Blob([fs.readFileSync("tests/fixtures/synthetic-recovery.pdf")]), "test.pdf", "application/pdf");
    const result = await extractDocumentClaimsForPath({ ...base, supabase: mock.supabase });
    expect(fetch).toHaveBeenCalledTimes(1); expect(result.mode).toBe("pdf-text-fallback"); expect(result.providerUsed).toBe("none");
    expect(result.count).toBe(4); expect(mock.inserted.every(row => row.page_number === 1 && row.nature === "REPORTED" && row.timestamp_claimed == null)).toBe(true);
  });
  it("Gemini test fallback receives native PDF only with all explicit gates", async () => {
    clear(); process.env.LOVABLE_API_KEY = "synthetic-primary"; process.env.GEMINI_API_KEY = "synthetic-test-key";
    process.env.CLAIM_GEMINI_TEST_FALLBACK_ENABLED = "true"; process.env.CLAIM_GEMINI_FREE_TIER_CONFIRMED = "true";
    const fetch = vi.fn().mockResolvedValueOnce(new Response("quota", { status: 402 })).mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ claims: [{ page_number: 1, claim_text: "Synthetic fallback claim", nature: "REPORTED", confidence: 0.6 }] }) }] } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch); const mock = db(new Blob([fs.readFileSync("tests/fixtures/synthetic-recovery.pdf")]), "test.pdf", "application/pdf");
    const result = await extractDocumentClaimsForPath({ ...base, supabase: mock.supabase, allowTestFallback: true });
    expect(result.providerUsed).toBe("gemini-test"); expect(result.mode).toBe("ai"); expect(fetch).toHaveBeenCalledTimes(2);
    const [url, init] = fetch.mock.calls[1]; expect(url).toContain("gemini-flash-lite-latest:generateContent");
    // PDFs with a text layer are sent as page-tagged text so page provenance survives and long files are chunked.
    expect(JSON.parse(init.body).contents[0].parts[1].text).toContain("[page 1]");
  });
  it("OpenRouter cannot select a paid model or weaken privacy", async () => {
    clear(); process.env.LOVABLE_API_KEY = "synthetic-primary"; process.env.OPENROUTER_API_KEY = "synthetic-router"; process.env.CLAIM_OPENROUTER_FREE_FALLBACK_ENABLED = "true";
    const fetch = vi.fn().mockResolvedValueOnce(new Response("quota", { status: 402 })).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ claims: [{ claim_text: "Synthetic free route", nature: "REPORTED" }] }) } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch); const mock = db(new Blob(["Synthetic line"]), "test.txt", "text/plain");
    const result = await extractDocumentClaimsForPath({ ...base, supabase: mock.supabase }); expect(result.providerUsed).toBe("openrouter");
    const body = JSON.parse(fetch.mock.calls[1][1].body); expect(body.model).toBe("openrouter/free"); expect(body.provider).toEqual({ data_collection: "deny", zdr: true }); expect(body.plugins).toBeUndefined();
  });
  it("free providers are disabled by default; Gemini needs all gates", () => {
    clear(); process.env.GEMINI_API_KEY = "synthetic-key"; expect(enabledFreeFallbacks(true)).toEqual([]);
    process.env.CLAIM_GEMINI_TEST_FALLBACK_ENABLED = "true"; expect(enabledFreeFallbacks(true)).toEqual([]);
    process.env.CLAIM_GEMINI_FREE_TIER_CONFIRMED = "true"; expect(enabledFreeFallbacks(false)).toEqual([]); expect(enabledFreeFallbacks(true)).toEqual(["gemini-test"]);
  });
});
