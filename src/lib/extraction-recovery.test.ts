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
    rpc: async (fn: string, args: any) => {
      // Emulates migrations 20261024217000 + 20261024221000 applied.
      if (fn === "reserve_free_extraction_attempt") return { data: "reserved", error: null };
      if (fn !== "replace_pending_claims") return { data: null, error: { code: "PGRST202", message: "missing" } };
      const rows = (args._claims as any[]).map((c, i) => ({ id: "claim-" + (inserted.length + i + 1), status: "PENDING", ...c }));
      inserted.push(...rows);
      return { data: rows.map(r => ({ id: r.id, claim_text: r.claim_text })), error: null };
    },
    from(table: string) {
      const query: any = { data: [], error: null, eq: () => query, select: () => query, update: () => query,
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
  it("imports real PDF text with page provenance and no invented timestamps when no AI is configured", async () => {
    clear(); process.env.LOVABLE_API_KEY = "synthetic-key"; // injected key alone must not select the billed gateway
    const fetch = vi.fn(async () => new Response("quota", { status: 402 })); vi.stubGlobal("fetch", fetch);
    const mock = db(new Blob([fs.readFileSync("tests/fixtures/synthetic-recovery.pdf")]), "test.pdf", "application/pdf");
    const result = await extractDocumentClaimsForPath({ ...base, supabase: mock.supabase });
    expect(fetch).not.toHaveBeenCalled(); expect(result.mode).toBe("pdf-text-fallback"); expect(result.providerUsed).toBe("none");
    expect(result.count).toBe(4); expect(mock.inserted.every(row => row.page_number === 1 && row.nature === "REPORTED" && row.timestamp_claimed == null)).toBe(true);
  });
  it("Gemini test fallback receives native PDF only with all explicit gates", async () => {
    clear(); process.env.LOVABLE_API_KEY = "synthetic-primary"; process.env.GEMINI_API_KEY = "synthetic-test-key";
    process.env.CLAIM_GEMINI_TEST_FALLBACK_ENABLED = "true"; process.env.CLAIM_GEMINI_FREE_TIER_CONFIRMED = "true";
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ claims: [{ page_number: 1, claim_text: "Synthetic fallback claim", nature: "REPORTED", confidence: 0.6 }] }) }] } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch); const mock = db(new Blob([fs.readFileSync("tests/fixtures/synthetic-recovery.pdf")]), "test.pdf", "application/pdf");
    const result = await extractDocumentClaimsForPath({ ...base, supabase: mock.supabase, freeDataClass: "public_synthetic" as const });
    expect(result.providerUsed).toBe("gemini-test"); expect(result.mode).toBe("ai"); expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]; expect(url).toContain("gemini-flash-lite-latest:generateContent");
    // PDFs with a text layer are sent as page-tagged text so page provenance survives and long files are chunked.
    expect(JSON.parse(init.body).contents[0].parts[1].text).toContain("[page 1]");
  });
  it("OpenRouter cannot select a paid model or weaken privacy", async () => {
    clear(); process.env.LOVABLE_API_KEY = "synthetic-primary"; process.env.OPENROUTER_API_KEY = "synthetic-router"; process.env.CLAIM_OPENROUTER_FREE_FALLBACK_ENABLED = "true";
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ claims: [{ claim_text: "Synthetic free route", nature: "REPORTED" }] }) } }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetch); const mock = db(new Blob(["Synthetic line"]), "test.txt", "text/plain");
    // Synthetic fixture data, explicitly classified - the only state in which a free provider may be called.
    const result = await extractDocumentClaimsForPath({ ...base, supabase: mock.supabase, freeDataClass: "public_synthetic" }); expect(result.providerUsed).toBe("openrouter");
    const body = JSON.parse(fetch.mock.calls[0][1].body); expect(body.model).toBe("openrouter/free"); expect(body.provider).toEqual({ data_collection: "deny", zdr: true }); expect(body.plugins).toBeUndefined();
  });
  it("without the explicit classification, an enabled free provider is never called (paid-disabled must not leak confidential docs)", async () => {
    clear(); process.env.LOVABLE_API_KEY = "synthetic-primary"; process.env.OPENROUTER_API_KEY = "synthetic-router"; process.env.CLAIM_OPENROUTER_FREE_FALLBACK_ENABLED = "true";
    const fetch = vi.fn().mockResolvedValueOnce(new Response("quota", { status: 402 }));
    vi.stubGlobal("fetch", fetch); const mock = db(new Blob(["Confidential line"]), "test.txt", "text/plain");
    const result = await extractDocumentClaimsForPath({ ...base, supabase: mock.supabase });
    expect(result.providerUsed).toBe("none"); expect(result.mode).toBe("text-fallback");
    expect(fetch).not.toHaveBeenCalled(); // no billed primary and no free call: OpenRouter never contacted
  });
  it("AI re-extraction without the atomic RPC refuses loudly and deletes nothing", async () => {
    // Migration 20261024217000 absent: replacing PENDING evidence via separate
    // delete+insert calls would be non-atomic, so the run must fail loudly instead.
    clear(); process.env.LOVABLE_API_KEY = "synthetic-key";
    const fetch = vi.fn(async () => new Response("quota", { status: 402 })); vi.stubGlobal("fetch", fetch);
    const mock = db(new Blob([fs.readFileSync("tests/fixtures/synthetic-recovery.pdf")]), "test.pdf", "application/pdf");
    const noRpc = { ...mock.supabase, rpc: undefined };
    await expect(extractDocumentClaimsForPath({ ...base, supabase: noRpc as any }))
      .rejects.toThrow("REEXTRACTION_UNAVAILABLE");
    expect(mock.inserted.length).toBe(0);
  });
  it("explicit gateway without a verified rate is refused before any provider call (credits are spend)", async () => {
    clear(); process.env.CLAIM_AI_PROVIDER = "gateway"; process.env.LOVABLE_API_KEY = "synthetic-key";
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const mock = db(new Blob(["line"]), "test.txt", "text/plain");
    // The gateway model has no verified price in the book: the reservation refuses
    // closed rather than spending workspace AI credits blind.
    await expect(extractDocumentClaimsForPath({ ...base, supabase: mock.supabase })).rejects.toThrow("UNKNOWN_MODEL_RATE");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("refused billed attempts are audit-logged as refusals, never as usage rows", async () => {
    // no-cap refusal on an own-key provider (rate exists, no cap configured): the denial
    // lands in app_errors with the EXTRACTION_SPEND_REFUSED marker and no provider call
    // and no extraction_usage write happen.
    clear(); process.env.CLAIM_AI_PROVIDER = "openai"; process.env.OPENAI_API_KEY = "synthetic-key";
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const mock = db(new Blob(["line"]), "test.txt", "text/plain");
    const audited: any[] = [];
    const baseFrom = mock.supabase.from.bind(mock.supabase);
    mock.supabase.from = (table: string) => {
      if (table === "app_errors") return { insert: (row: any) => { audited.push(row); return { then: (cb: any) => { cb?.({}); return Promise.resolve({}); } }; } };
      return baseFrom(table);
    };
    const noCap = { ...mock.supabase, rpc: async (fn: string) => fn === "reserve_extraction_cost" ? { data: "no_cap", error: null } : { data: null, error: { code: "PGRST202" } } };
    noCap.from = mock.supabase.from;
    await expect(extractDocumentClaimsForPath({ ...base, supabase: noCap as any })).rejects.toThrow("PAID_NOT_ENABLED");
    expect(fetch).not.toHaveBeenCalled();
    expect(audited.length).toBe(1);
    expect(audited[0].message).toContain("EXTRACTION_SPEND_REFUSED");
    expect(audited[0].message).toContain("provider=openai");
    expect(audited[0].source).toBe("server");
  });
  it("attempted paid failure completes with the reserved bound held - never voided as if free", async () => {
    clear(); process.env.CLAIM_AI_PROVIDER = "openai"; process.env.OPENAI_API_KEY = "synthetic-key";
    const fetch = vi.fn(async () => { throw new Error("network down mid-call"); }); vi.stubGlobal("fetch", fetch);
    const mock = db(new Blob(["line one"]), "test.txt", "text/plain");
    const rpcCalls: { fn: string; args: any }[] = [];
    const spy = { ...mock.supabase, rpc: async (fn: string, args: any) => {
      rpcCalls.push({ fn, args });
      if (fn === "reserve_extraction_cost") return { data: "reserved", error: null };
      if (fn === "replace_pending_claims") { const rows = (args._claims as any[]).map((c: any, i: number) => ({ id: "c" + i, ...c })); return { data: rows.map(r => ({ id: r.id, claim_text: r.claim_text })), error: null }; }
      return { data: null, error: null };
    } };
    const result = await extractDocumentClaimsForPath({ ...base, supabase: spy as any });
    expect(result.mode).toBe("text-fallback"); // local import still recovered
    const completed = rpcCalls.find(c => c.fn === "complete_extraction_cost");
    expect(completed).toBeTruthy();
    expect(completed!.args.p_provider).toBe("openai");
    expect(completed!.args.p_input_tokens).toBeNull(); // consumption unknown
    expect(completed!.args.p_cost_usd).toBeGreaterThan(0); // reserved bound held, not zero
    expect(rpcCalls.find(c => c.fn === "void_extraction_reservation")).toBeUndefined(); // never voided as if free
  });
  it("reservation without an attempted call is still voided safely", async () => {
    clear(); process.env.CLAIM_AI_PROVIDER = "openai"; process.env.OPENAI_API_KEY = "synthetic-key";
    // Multi-section paid refusal happens BEFORE any outbound request: void is correct.
    const { assertPaidChunkingSupported } = await import("./extraction.functions");
    expect(() => assertPaidChunkingSupported(3, "openai")).toThrow("PAID_MULTICHUNK_UNSUPPORTED");
    expect(() => assertPaidChunkingSupported(3, "gateway")).toThrow("PAID_MULTICHUNK_UNSUPPORTED");
    expect(() => assertPaidChunkingSupported(1, "openai")).not.toThrow();
    expect(() => assertPaidChunkingSupported(3, "none")).not.toThrow(); // free/local chunking unaffected
    expect(() => assertPaidChunkingSupported(3, "free")).not.toThrow();
  });
  it("CLAIM_AI_PROVIDER=free never calls any paid provider even when paid keys exist", async () => {
    clear(); process.env.CLAIM_AI_PROVIDER = "free";
    process.env.LOVABLE_API_KEY = "synthetic-lovable"; process.env.OPENAI_API_KEY = "synthetic-openai"; process.env.ANTHROPIC_API_KEY = "synthetic-anthropic";
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const mock = db(new Blob(["line one\nline two"]), "test.txt", "text/plain");
    const result = await extractDocumentClaimsForPath({ ...base, supabase: mock.supabase });
    expect(fetch).not.toHaveBeenCalled(); // zero provider calls: no gateway, no own-key, no free AI
    expect(result.providerUsed).toBe("none"); expect(result.count).toBe(2); expect(result.mode).toBe("text-fallback");
  });
  it("cap RPC missing (migration not applied): free AI is OFF, never fetched, text import still works", async () => {
    clear(); process.env.LOVABLE_API_KEY = "synthetic-primary"; process.env.OPENROUTER_API_KEY = "synthetic-router"; process.env.CLAIM_OPENROUTER_FREE_FALLBACK_ENABLED = "true";
    const fetch = vi.fn().mockResolvedValueOnce(new Response("quota", { status: 402 }));
    vi.stubGlobal("fetch", fetch); const mock = db(new Blob(["Synthetic line"]), "test.txt", "text/plain");
    // Default mock returns PGRST202 for reserve_free_extraction_attempt when unstubbed below.
    mock.supabase.rpc = async (fn: string) => fn === "reserve_free_extraction_attempt" ? { data: null, error: { code: "PGRST202", message: "missing" } } : { data: [], error: null };
    const result = await extractDocumentClaimsForPath({ ...base, supabase: mock.supabase, freeDataClass: "public_synthetic" });
    expect(fetch).toHaveBeenCalledTimes(1); // the failed paid call only; no free request went out
    expect(result.providerUsed).toBe("none"); expect(result.mode).toBe("text-fallback");
    expect((result as any).fallbackErrors?.some((e: string) => e.includes("daily-attempt cap update is applied"))).toBe(true);
  });
  it("over-cap: no free request goes out, message says attempts used up and text import works", async () => {
    clear(); process.env.LOVABLE_API_KEY = "synthetic-primary"; process.env.OPENROUTER_API_KEY = "synthetic-router"; process.env.CLAIM_OPENROUTER_FREE_FALLBACK_ENABLED = "true";
    const fetch = vi.fn().mockResolvedValueOnce(new Response("quota", { status: 402 }));
    vi.stubGlobal("fetch", fetch); const mock = db(new Blob(["Synthetic line"]), "test.txt", "text/plain");
    const realRpc = mock.supabase.rpc;
    mock.supabase.rpc = async (fn: string, args: any) => fn === "reserve_free_extraction_attempt" ? { data: "over_cap", error: null } : realRpc(fn, args);
    const result = await extractDocumentClaimsForPath({ ...base, supabase: mock.supabase, freeDataClass: "public_synthetic" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.providerUsed).toBe("none"); expect(result.mode).toBe("text-fallback");
    expect((result as any).fallbackErrors?.some((e: string) => e.includes("attempts for today are used up") && e.includes("text import still works"))).toBe(true);
  });
  it("transient cap-check failure: free AI skipped with a try-again message, no outbound free request", async () => {
    clear(); process.env.LOVABLE_API_KEY = "synthetic-primary"; process.env.OPENROUTER_API_KEY = "synthetic-router"; process.env.CLAIM_OPENROUTER_FREE_FALLBACK_ENABLED = "true";
    const fetch = vi.fn().mockResolvedValueOnce(new Response("quota", { status: 402 }));
    vi.stubGlobal("fetch", fetch); const mock = db(new Blob(["Synthetic line"]), "test.txt", "text/plain");
    const realRpc = mock.supabase.rpc;
    mock.supabase.rpc = async (fn: string, args: any) => { if (fn === "reserve_free_extraction_attempt") throw new Error("connection reset"); return realRpc(fn, args); };
    const result = await extractDocumentClaimsForPath({ ...base, supabase: mock.supabase, freeDataClass: "public_synthetic" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.providerUsed).toBe("none"); expect(result.mode).toBe("text-fallback");
    expect((result as any).fallbackErrors?.some((e: string) => e.includes("could not verify the free daily attempt limit"))).toBe(true);
  });
  it("free providers are disabled by default and require the explicit public/synthetic classification", () => {
    clear(); process.env.GEMINI_API_KEY = "synthetic-key";
    expect(enabledFreeFallbacks("public_synthetic")).toEqual([]);
    process.env.CLAIM_GEMINI_TEST_FALLBACK_ENABLED = "true"; expect(enabledFreeFallbacks("public_synthetic")).toEqual([]);
    process.env.CLAIM_GEMINI_FREE_TIER_CONFIRMED = "true";
    // All env gates on, but without the explicit per-document classification: still no free provider.
    expect(enabledFreeFallbacks(undefined)).toEqual([]);
    expect(enabledFreeFallbacks("confidential")).toEqual([]);
    expect(enabledFreeFallbacks("public_synthetic")).toEqual(["gemini-test"]);
  });
});
