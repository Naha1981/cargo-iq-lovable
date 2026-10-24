import { insertClaimRow } from "./claim-insert";
import { analysisStatus, candidateDateMismatches, encodeExtractionStatus } from "./analysis-integrity";
import { readPdfLines, readPdfPages } from "./pdf-text";
import { assertDocumentSize, isPlainDocument, plainTextClaims, PDF_AI_UNAVAILABLE } from "./extraction-policy";
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";

type ClaimDraft = {
  page_number?: number;
  claim_text: string;
  claim_type?: string;
  normalized_value?: unknown;
  evidence_class: string;
  nature: "OBSERVED" | "REPORTED" | "DERIVED" | "INFERRED";
  confidence?: number;
  timestamp_claimed?: string;
  event_reference?: string;
};

// Match whole filename tokens, not substrings: "report.pdf" must not match "port".
export function inferClass(name: string) {
  const tokens = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.includes("contract") || tokens.includes("agreement")) return "CONTRACTUAL";
  if (tokens.includes("terminal") || tokens.includes("port")) return "OFFICIAL_PUBLIC";
  return "CUSTOMER_PRIMARY";
}

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
// A model may turn "February 2014" or "2012/2013" into 2014-02-01 or 2012-01-01. Keep a timestamp only when the claim
// itself states the day (an ISO date, "28 January", or "January 28"); otherwise the date stays in the text only.
export function dayAnchored(claimText: string, iso: string): boolean {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return false;
  const day = d.getUTCDate(), mon = d.getUTCMonth();
  const isoPart = d.toISOString().slice(0, 10);
  if (claimText.includes(isoPart)) return true;
  const re = new RegExp("\\b(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+(" + MONTHS + ")\\b|(" + MONTHS + ")\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b)", "gi");
  const names = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  for (const m of claimText.matchAll(re)) {
    const dd = Number(m[1] ?? m[4]), mm = String(m[2] ?? m[3]).toLowerCase().slice(0, 3);
    if (dd === day && names.indexOf(mm) === mon) return true;
  }
  return false;
}

function parseJsonModel(text: string): ClaimDraft[] {
  const cleaned = text.replace(/^\`\`\`json\s*/i, "").replace(/^\`\`\`\s*$/i, "").trim();
  const parsed = JSON.parse(cleaned);
  const rows = Array.isArray(parsed) ? parsed : parsed.claims;
  if (!Array.isArray(rows)) throw new Error("EXTRACTION_JSON_SHAPE");
  const mapped = rows.map((row: any) => ({
    page_number: Number.isFinite(Number(row.page_number)) ? Number(row.page_number) : undefined,
    claim_text: String(row.claim_text ?? "").trim(),
    claim_type: row.claim_type ? String(row.claim_type) : undefined,
    event_reference: row.event_reference ? String(row.event_reference).trim() : undefined,
    normalized_value: row.normalized_value ?? row.value ?? null,
    evidence_class: String(row.evidence_class ?? "CUSTOMER_PRIMARY"),
    nature: ["OBSERVED","REPORTED","DERIVED","INFERRED"].includes(row.nature) ? row.nature : "REPORTED",
    confidence: Number.isFinite(Number(row.confidence)) ? Math.max(0, Math.min(1, Number(row.confidence))) : 0.7,
    timestamp_claimed: row.timestamp_claimed && !isNaN(Date.parse(row.timestamp_claimed)) && dayAnchored(String(row.claim_text ?? ""), String(row.timestamp_claimed)) ? new Date(row.timestamp_claimed).toISOString() : undefined,
  }));
  const kept = mapped.filter((row: ClaimDraft) => row.claim_text.length > 0);
  // A provider that answered with rows but none we can read broke the field contract. Fail loudly
  // instead of silently dropping everything and falling back to raw text lines.
  if (mapped.length > 0 && kept.length === 0) throw new Error("EXTRACTION_SCHEMA_MISMATCH");
  return kept;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

function claimPrompt(filename: string) {
  return [
    "You are CargoIQ's evidence extraction engine for freight, port and logistics disputes.",
    "Extract only facts anchored to the document. Never invent missing data.",
    "Use evidence_class CUSTOMER_PRIMARY unless clearly CONTRACTUAL or OFFICIAL_PUBLIC.",
    "Use OBSERVED for explicit facts, REPORTED for a party assertion, DERIVED only for arithmetic shown, INFERRED only where inference is explicit.",
    "Dates ISO-8601 when confident, else empty string. Confidence 0..1. page_number is the 1-based page the fact appears on.",
    "event_reference: only an explicit unique operation or visit ID in the source, else empty. A reusable vehicle/container ID alone does not identify one event. Never invent a cross-document identity.",
    "Be exhaustive for a dispute file: extract every dated event, every container or vehicle identifier, every count, quantity, rate and amount, and every statement that a contract, invoice, statement or record was or was not produced or is missing.",
    "Attribute each claim to whoever asserts it inside claim_text (for example 'The court found...', 'The witness X testified...', 'The pleadings allege...', 'MSC demanded...'). Never present a witness allegation, pleading or party demand as a finding. A court or tribunal's own conclusion is a separate claim from the allegations it weighs.",
    "When the source gives different figures for the same thing (for example different container counts or different invoice dates), keep each figure as its own claim with its own page. Do not pick one and do not say which is wrong unless the source does.",
    "Filename: " + filename,
  ].join("\n");
}

const claimSchema = {
    type: "object", additionalProperties: false, required: ["claims"],
    properties: { claims: { type: "array", items: {
      type: "object", additionalProperties: false,
      required: ["page_number", "claim_text", "claim_type", "value", "evidence_class", "nature", "confidence", "timestamp_claimed", "event_reference"],
      properties: {
        page_number: { type: "integer" }, claim_text: { type: "string" }, claim_type: { type: "string" }, value: { type: "string" },
        evidence_class: { type: "string", enum: ["CUSTOMER_PRIMARY", "CONTRACTUAL", "OFFICIAL_PUBLIC"] },
        nature: { type: "string", enum: ["OBSERVED", "REPORTED", "DERIVED", "INFERRED"] },
        confidence: { type: "number" }, timestamp_claimed: { type: "string" }, event_reference: { type: "string" },
      } } } },
  };

export type ClaimAiProvider = { kind: "openai" | "anthropic" | "gateway" | "none"; label: string };

// Server-side only. Keys are read from the environment and never sent to the client.
export function resolveClaimAiProvider(): ClaimAiProvider {
  const openai = process.env["OPENAI_API_KEY"];
  const anthropic = process.env["ANTHROPIC_API_KEY"];
  const wanted = (process.env["CLAIM_AI_PROVIDER"] ?? "").toLowerCase();
  if (wanted && !["openai", "anthropic", "gateway"].includes(wanted)) throw new Error("Unknown CLAIM_AI_PROVIDER. Choose openai, anthropic, or gateway.");
  if (wanted === "openai" && !openai) throw new Error("CLAIM_AI_PROVIDER is openai but OPENAI_API_KEY is not configured.");
  if (wanted === "anthropic" && !anthropic) throw new Error("CLAIM_AI_PROVIDER is anthropic but ANTHROPIC_API_KEY is not configured.");
  if (wanted === "gateway") {
    if (!process.env["LOVABLE_API_KEY"]) throw new Error("CLAIM_AI_PROVIDER is gateway but LOVABLE_API_KEY is not configured.");
    return { kind: "gateway", label: "Using Lovable gateway" };
  }
  if (wanted === "anthropic" && anthropic) return { kind: "anthropic", label: "Using your own Anthropic key" };
  if (wanted === "openai" && openai) return { kind: "openai", label: "Using your own OpenAI key" };
  if (!wanted && openai) return { kind: "openai", label: "Using your own OpenAI key" };
  if (!wanted && anthropic) return { kind: "anthropic", label: "Using your own Anthropic key" };
  if (process.env["LOVABLE_API_KEY"]) return { kind: "gateway", label: "Using Lovable gateway" };
  return { kind: "none", label: "No AI key configured" };
}

async function readError(res: Response, name: string) {
  const msg = await res.text().catch(() => "");
  if (res.status === 401) return new Error(name + " rejected the API key (401). Check the key set for this project.");
  if (res.status === 402 || res.status === 403) return new Error(name + " refused the request (" + res.status + "). Check the key, billing and model access.");
  if (res.status === 429) return new Error(name + " is rate limited - try again in a minute.");
  return new Error("AI_" + res.status + " " + msg.slice(0, 200));
}

async function extractViaOpenAi(bytes: ArrayBuffer, mimeType: string, filename: string) {
  const key = process.env["OPENAI_API_KEY"]!;
  const isText = /^text\//.test(mimeType) || /\.(csv|txt)$/i.test(filename);
  const isImage = /^image\//.test(mimeType);
  const b64 = isText ? "" : bytesToBase64(new Uint8Array(bytes));
  const content: any[] = [{ type: "input_text", text: claimPrompt(filename) }];
  if (isText) content.push({ type: "input_text", text: "DOCUMENT (page 1):\n" + new TextDecoder().decode(bytes).slice(0, 200000) });
  else if (isImage) content.push({ type: "input_image", image_url: `data:${mimeType};base64,${b64}` });
  else content.push({ type: "input_file", filename, file_data: `data:${mimeType || "application/pdf"};base64,${b64}` });
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", signal: AbortSignal.timeout(45000),
    headers: { "content-type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model: process.env["CLAIM_AI_MODEL"] || "gpt-4o-mini", store: false,
      input: [{ role: "user", content }],
      text: { format: { type: "json_schema", name: "claims", strict: true, schema: claimSchema } },
    }),
  });
  if (!res.ok) throw await readError(res, "OpenAI");
  const json: any = await res.json();
  const text = json.output_text ?? (json.output ?? []).flatMap((o: any) => o.content ?? []).filter((c: any) => c.type === "output_text").map((c: any) => c.text).join("");
  return parseJsonModel(String(text ?? "")).map((c) => ({ ...c, timestamp_claimed: c.timestamp_claimed || undefined }));
}

async function extractViaAnthropic(bytes: ArrayBuffer, mimeType: string, filename: string) {
  const key = process.env["ANTHROPIC_API_KEY"]!;
  const isText = /^text\//.test(mimeType) || /\.(csv|txt)$/i.test(filename);
  const isImage = /^image\//.test(mimeType);
  const b64 = isText ? "" : bytesToBase64(new Uint8Array(bytes));
  const content: any[] = [];
  if (isText) content.push({ type: "text", text: "DOCUMENT (page 1):\n" + new TextDecoder().decode(bytes).slice(0, 200000) });
  else if (isImage) content.push({ type: "image", source: { type: "base64", media_type: mimeType, data: b64 } });
  else content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } });
  content.push({ type: "text", text: claimPrompt(filename) + "\nReturn ONLY a JSON object of the form {\"claims\": [...]} where each claim has: page_number, claim_text, claim_type, value, evidence_class, nature, confidence, timestamp_claimed. No prose." });
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", signal: AbortSignal.timeout(45000),
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: process.env["CLAIM_AI_MODEL"] || "claude-3-5-sonnet-latest", max_tokens: 8000, messages: [{ role: "user", content }] }),
  });
  if (!res.ok) throw await readError(res, "Anthropic");
  const json: any = await res.json();
  const text = (json.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  return parseJsonModel(start >= 0 && end > start ? text.slice(start, end + 1) : text).map((c) => ({ ...c, timestamp_claimed: c.timestamp_claimed || undefined }));
}

async function extractWholeDocument(bytes: ArrayBuffer, mimeType: string, filename: string) {
  const provider = resolveClaimAiProvider();
  if (provider.kind === "openai") return extractViaOpenAi(bytes, mimeType, filename);
  if (provider.kind === "anthropic") return extractViaAnthropic(bytes, mimeType, filename);
  return extractViaGateway(bytes, mimeType, filename);
}

/**
 * Provider-neutral chunking for the configured production route. A long text PDF is read page by page in sections,
 * each sent through the same route as plain text with page tags. A failed section is retried once; if it still fails
 * its pages are reported in `warnings` (extraction INCOMPLETE) and the other sections are kept. Nothing is dropped silently.
 * Documents that fit one section, scanned PDFs and images keep the whole-document path.
 */
export async function extractChunked(call: (b: ArrayBuffer, mime: string, name: string) => Promise<ClaimDraft[]>, pages: string[], filename: string, warnings: string[]): Promise<ClaimDraft[]> {
  const chunks = chunkPages(pages);
  if (chunks.length > GEMINI_MAX_CHUNKS) throw new Error("DOCUMENT_TOO_LONG_" + chunks.length);
  const all: ClaimDraft[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const text = "This is section " + (i + 1) + " of " + chunks.length + " of a longer document. Page numbers are in [page N] tags; use them as page_number.\n" + chunks[i];
    const bytes = new TextEncoder().encode(text).buffer as ArrayBuffer;
    const range = (chunks[i]!.match(/\[page (\d+)/g) ?? []).map((m) => m.replace("[page ", ""));
    const label = "pages " + (range[0] ?? "?") + "-" + (range[range.length - 1] ?? "?");
    let done = false;
    for (let attempt = 0; attempt < 2 && !done; attempt++) {
      try { all.push(...await call(bytes, "text/plain", filename)); done = true; }
      catch (e) { if (attempt === 1) warnings.push("section " + (i + 1) + "/" + chunks.length + " (" + label + ") failed: " + (e instanceof Error ? e.message : "error").slice(0, 100)); }
    }
  }
  if (!all.length) throw new Error("NO_SECTION_SUCCEEDED");
  const gaps = missingContainerIds(pages, all);
  if (gaps.length) warnings.push("Container IDs in the source but not in any claim: " + gaps.map((g) => g.id + " (p" + g.page + ")").join(", "));
  return all;
}

/** Name kept for history: this runs the configured production provider route (openai, anthropic or gateway), chunked for long PDFs. */
export async function extractWithGemini(bytes: ArrayBuffer, mimeType: string, filename: string, warnings: string[] = []) {
  const isPdf = mimeType === "application/pdf" || /\.pdf$/i.test(filename);
  if (isPdf) {
    const pages = await readPdfPages(bytes).catch(() => [] as string[]);
    if (pages.length && chunkPages(pages).length > 1) return extractChunked(extractWholeDocument, pages, filename, warnings);
  }
  return extractWholeDocument(bytes, mimeType, filename);
}

async function extractViaGateway(bytes: ArrayBuffer, mimeType: string, filename: string) {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI_KEY_NOT_CONFIGURED");
  const prompt = claimPrompt(filename);
  const isText = /^text\//.test(mimeType) || /\.(csv|txt)$/i.test(filename);
  const isImage = /^image\//.test(mimeType);
  const b64 = isText ? "" : bytesToBase64(new Uint8Array(bytes));
  const content: any[] = [{ type: "input_text", text: prompt }];
  if (isText) content.push({ type: "input_text", text: "DOCUMENT (page 1):\n" + new TextDecoder().decode(bytes).slice(0, 200000) });
  else if (isImage) content.push({ type: "input_image", image_url: `data:${mimeType};base64,${b64}` });
  else content.push({ type: "input_file", filename, file_data: `data:${mimeType || "application/pdf"};base64,${b64}` });

  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST", signal: AbortSignal.timeout(45000),
    headers: { "content-type": "application/json", "Lovable-API-Key": key, Authorization: `Bearer ${key}`, "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: "openai/gpt-6-astra", stream: true, store: false,
      reasoning: { effort: "low" },
      input: [{ role: "user", content }],
      text: { format: { type: "json_schema", name: "claims", strict: true, schema: claimSchema } },
    }),
  });
  if (!res.ok || !res.body) {
    const msg = await res.text().catch(() => "");
    if (res.status === 402) throw new Error("AI credits exhausted. Use TXT/CSV text mode without AI credits.");
    if (res.status === 429) throw new Error("AI is rate limited — try again in a minute.");
    throw new Error("AI_" + res.status + " " + msg.slice(0, 200));
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const d = line.slice(5).trim();
      if (!d || d === "[DONE]") continue;
      try {
        const ev = JSON.parse(d);
        if (ev.type === "response.output_text.delta") out += ev.delta ?? "";
        if (ev.type === "response.failed" || ev.type === "error") throw new Error("AI_FAILED " + JSON.stringify(ev.error ?? ev.response?.error ?? "").slice(0, 200));
      } catch (e) { if (e instanceof Error && e.message.startsWith("AI_FAILED")) throw e; }
    }
  }
  return parseJsonModel(out).map((c) => ({ ...c, timestamp_claimed: c.timestamp_claimed || undefined }));
}

// Every free provider is opt-in. Never silently route to a paid model or paid OCR plugin.
export function enabledFreeFallbacks(allowTestFallback = false) {
  const providers: ("openrouter" | "groq" | "gemini-test")[] = [];
  if (process.env.CLAIM_OPENROUTER_FREE_FALLBACK_ENABLED === "true" && process.env.OPENROUTER_API_KEY) providers.push("openrouter");
  if (process.env.CLAIM_GROQ_FREE_PLAN_CONFIRMED === "true" && process.env.GROQ_API_KEY) providers.push("groq");
  if (allowTestFallback && process.env.CLAIM_GEMINI_TEST_FALLBACK_ENABLED === "true" && process.env.CLAIM_GEMINI_FREE_TIER_CONFIRMED === "true" && process.env.GEMINI_API_KEY) providers.push("gemini-test");
  return providers;
}

// Free Gemini test path. Model is configurable and defaults to Google's own "latest" alias for the
// flash-lite tier, so a retired dated model name cannot silently break extraction.
export const GEMINI_TEST_MODEL_DEFAULT = "gemini-flash-lite-latest";
export function geminiTestModel() { return (process.env.CLAIM_GEMINI_TEST_MODEL || GEMINI_TEST_MODEL_DEFAULT).replace(/^models\//, ""); }
const GEMINI_CHUNK_CHARS = 12000;
const GEMINI_MAX_CHUNKS = 12;
export function chunkPages(pages: string[], maxChars = GEMINI_CHUNK_CHARS): string[] {
  const chunks: string[] = []; let cur = "";
  pages.forEach((text, i) => {
    const tagged = "[page " + (i + 1) + "]\n" + text + "\n";
    // A single oversized page is split on line boundaries but keeps its page tag.
    const parts: string[] = [];
    if (tagged.length <= maxChars) parts.push(tagged);
    else { let buf = "[page " + (i + 1) + "]\n"; for (const line of text.split("\n")) { if (buf.length + line.length + 1 > maxChars && buf.length > 20) { parts.push(buf); buf = "[page " + (i + 1) + " continued]\n"; } buf += line + "\n"; } parts.push(buf); }
    for (const part of parts) { if (cur && cur.length + part.length > maxChars) { chunks.push(cur); cur = ""; } cur += part; }
  });
  if (cur) chunks.push(cur);
  return chunks;
}
const GEMINI_KEYS = 'Return ONLY a JSON object {"claims": [...]} where each claim has exactly these keys: page_number (integer), claim_text (string, one self-contained sentence naming who asserts it), claim_type (string), value (string), evidence_class (CUSTOMER_PRIMARY|CONTRACTUAL|OFFICIAL_PUBLIC), nature (OBSERVED|REPORTED|DERIVED|INFERRED), confidence (0..1), timestamp_claimed (ISO-8601 date or empty string), event_reference (string).';
const GEMINI_RESPONSE_SCHEMA = { type: "OBJECT", required: ["claims"], properties: { claims: { type: "ARRAY", items: { type: "OBJECT",
  required: ["page_number", "claim_text", "claim_type", "value", "evidence_class", "nature", "confidence", "timestamp_claimed", "event_reference"],
  properties: { page_number: { type: "INTEGER" }, claim_text: { type: "STRING" }, claim_type: { type: "STRING" }, value: { type: "STRING" },
    evidence_class: { type: "STRING", enum: ["CUSTOMER_PRIMARY", "CONTRACTUAL", "OFFICIAL_PUBLIC"] },
    nature: { type: "STRING", enum: ["OBSERVED", "REPORTED", "DERIVED", "INFERRED"] },
    confidence: { type: "NUMBER" }, timestamp_claimed: { type: "STRING" }, event_reference: { type: "STRING" } } } } } };
async function geminiCall(parts: any[], attempt = 0): Promise<ClaimDraft[]> {
  try { return await geminiCallOnce(parts); }
  catch (e) { if (attempt < 1 && e instanceof SyntaxError) return geminiCall(parts, attempt + 1); throw e; }
}
async function geminiCallOnce(parts: any[]) {
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + geminiTestModel() + ":generateContent", {
    method: "POST", signal: AbortSignal.timeout(60000), headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0, maxOutputTokens: 8192, responseMimeType: "application/json", responseSchema: GEMINI_RESPONSE_SCHEMA } }),
  });
  if (!res.ok) throw new Error("FREE_GEMINI_" + res.status);
  const json: any = await res.json();
  const reason = json.candidates?.[0]?.finishReason;
  // A cut-off answer is invalid JSON; never accept a partial chunk as if it were complete.
  if (reason && reason !== "STOP") throw new Error("FREE_GEMINI_FINISH_" + reason);
  return parseJsonModel((json.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join(""));
}

// Completeness audit. A model can silently skip a table row, so every ISO-6346 shaped container ID that appears in
// the source text must appear in at least one extracted claim. Missing ones get one targeted re-read of just their lines.
const CONTAINER_IN_TEXT = /\b([A-Z]{4})\s?(\d{6}\s?\d)\b/g;
const normId = (x: string) => x.toUpperCase().replace(/\s+/g, "");
export function missingContainerIds(pages: string[], claims: { claim_text: string; normalized_value?: unknown }[]): { id: string; page: number; lines: string[] }[] {
  const haystack = normId(claims.map((c) => c.claim_text + " " + (typeof c.normalized_value === "string" ? c.normalized_value : "")).join(" "));
  const found = new Map<string, { page: number; lines: string[] }>();
  pages.forEach((text, i) => text.split("\n").forEach((line) => {
    for (const m of line.matchAll(CONTAINER_IN_TEXT)) {
      const id = normId(m[1]! + m[2]!);
      const e = found.get(id) ?? { page: i + 1, lines: [] }; if (!e.lines.includes(line)) e.lines.push(line); found.set(id, e);
    }
  }));
  return [...found].filter(([id]) => !haystack.includes(id)).map(([id, v]) => ({ id, ...v }));
}
async function extractViaGeminiTest(bytes: ArrayBuffer, mimeType: string, filename: string, plain: boolean, warnings: string[] = []): Promise<ClaimDraft[]> {
  const head = claimPrompt(filename) + "\n" + GEMINI_KEYS;
  if (plain) return geminiCall([{ text: head }, { text: "DOCUMENT (page 1):\n" + new TextDecoder().decode(bytes) }]);
  const pages = mimeType === "application/pdf" || /\.pdf$/i.test(filename) || !mimeType ? await readPdfPages(bytes).catch(() => [] as string[]) : [];
  if (!pages.length) return geminiCall([{ text: head }, { inline_data: { mime_type: mimeType || "application/pdf", data: bytesToBase64(new Uint8Array(bytes)) } }]);
  const chunks = chunkPages(pages);
  if (chunks.length > GEMINI_MAX_CHUNKS) throw new Error("FREE_GEMINI_DOCUMENT_TOO_LONG_" + chunks.length);
  const all: ClaimDraft[] = [];
  for (const chunk of chunks) all.push(...await geminiCall([{ text: head + "\nThis is one section of a longer document. Page numbers are given in [page N] tags." }, { text: "DOCUMENT SECTION:\n" + chunk }]));
  const gaps = missingContainerIds(pages, all);
  if (gaps.length) {
    const lines = gaps.map((g) => "[page " + g.page + "]\n" + g.lines.join("\n")).join("\n");
    all.push(...await geminiCall([{ text: head + "\nThese lines were skipped in a first pass. Extract every fact in them, one claim per row or statement." }, { text: "DOCUMENT LINES:\n" + lines }]));
    const still = missingContainerIds(pages, all);
    if (still.length) warnings.push("Container IDs in the source but not in any claim: " + still.map((g) => g.id + " (p" + g.page + ")").join(", "));
  }
  return all;
}

// Second pass over the extracted claims: ask which pairs give DIFFERENT figures or dates for the same thing.
// Every flag cites two real claim numbers; invalid or self-pairs are dropped, so nothing is invented.
// Flags stay FLAGGED for human review. Ledger lines (separate payments, invoices, charges) are not conflicts.
export type DiscrepancyFlag = { a: number; b: number; kind: string; explanation: string };
export function parseDiscrepancies(text: string, claimCount: number): DiscrepancyFlag[] {
  const parsed = JSON.parse(text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim());
  const rows = Array.isArray(parsed) ? parsed : parsed.discrepancies;
  if (!Array.isArray(rows)) throw new Error("DISCREPANCY_JSON_SHAPE");
  const seen = new Set<string>(); const out: DiscrepancyFlag[] = [];
  for (const r of rows) {
    const a = Number(r.claim_a), b = Number(r.claim_b);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b || a < 1 || b < 1 || a > claimCount || b > claimCount) continue;
    const key = [Math.min(a, b), Math.max(a, b)].join("-"); if (seen.has(key)) continue; seen.add(key);
    const explanation = String(r.explanation ?? "").trim(); if (!explanation) continue;
    out.push({ a, b, kind: String(r.kind ?? "DIFFERENT_FIGURES").slice(0, 40), explanation: explanation.slice(0, 400) });
  }
  return out;
}
async function findGeminiDiscrepancies(claims: ClaimDraft[]): Promise<DiscrepancyFlag[]> {
  const list = claims.map((c, i) => (i + 1) + ". [p" + (c.page_number ?? "?") + "] " + c.claim_text).join("\n").slice(0, 60000);
  const prompt = [
    "You review extracted claims from a freight or shipping dispute file.",
    "Find every pair of claims where two figures, counts, dates or amounts are in tension: they are about the same group of items, the same document or the same event, but the numbers or dates differ, OR the source itself says it cannot reconcile them. Work through the claims carefully: list the container counts, invoice dates, amounts and event dates, then compare them.",
    "Do NOT flag separate ledger lines such as different payments, invoices or charges that merely have different dates or amounts. Do NOT flag claims that describe different events or different people's evidence on different subjects.",
    "Use only the numbered claims below. Never use outside knowledge. Say plainly what differs; do not say which is right unless a claim itself says so.",
    'Return ONLY JSON {"discrepancies":[{"claim_a":int,"claim_b":int,"kind":"DIFFERENT_FIGURES|DIFFERENT_DATES","explanation":"one sentence"}]}. Return an empty list when there are none.',
    "CLAIMS:\n" + list,
  ].join("\n");
  // Comparing many claims needs a stronger reasoning tier than extraction. Model is configurable; the default is Google's own alias.
  const model = (process.env.CLAIM_GEMINI_TEST_REVIEW_MODEL || "gemini-flash-latest").replace(/^models\//, "");
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent", {
    method: "POST", signal: AbortSignal.timeout(110000), headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 16000, responseMimeType: "application/json" } }),
  });
  if (!res.ok) throw new Error("FREE_GEMINI_" + res.status);
  const json: any = await res.json();
  if (json.candidates?.[0]?.finishReason && json.candidates[0].finishReason !== "STOP") throw new Error("FREE_GEMINI_FINISH_" + json.candidates[0].finishReason);
  return parseDiscrepancies((json.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join(""), claims.length);
}
async function extractFreeFallback(provider: "openrouter" | "groq" | "gemini-test", bytes: ArrayBuffer, mimeType: string, filename: string, warnings: string[] = []) {
  const plain = isPlainDocument(mimeType, filename);
  if (provider === "gemini-test") return extractViaGeminiTest(bytes, mimeType, filename, plain, warnings);
  const text = plain ? new TextDecoder().decode(bytes) : (await readPdfLines(bytes)).map(line => `[page ${line.page_number}] ${line.text}`).join("\n");
  plainTextClaims(text);
  const isRouter = provider === "openrouter";
  const res = await fetch(isRouter ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.groq.com/openai/v1/chat/completions", {
    method: "POST", signal: AbortSignal.timeout(30000),
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + (isRouter ? process.env.OPENROUTER_API_KEY : process.env.GROQ_API_KEY) },
    body: JSON.stringify({ model: isRouter ? "openrouter/free" : "openai/gpt-oss-20b", temperature: 0, max_tokens: 8000,
      ...(isRouter ? { provider: { data_collection: "deny", zdr: true } } : {}),
      messages: [{ role: "system", content: claimPrompt(filename) + '\nReturn ONLY a JSON object {"claims": [...]}.' }, { role: "user", content: "DOCUMENT:\n" + text }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error("FREE_" + provider.toUpperCase() + "_" + res.status);
  const json: any = await res.json();
  return parseJsonModel(json.choices?.[0]?.message?.content ?? "");
}

const CONTAINER_ID = /^[A-Z]{4}\s?\d{6,7}$/i;
const LEDGER_TYPES = /payment|invoice|charge|fee|receipt|tariff|rate|amount/i;
export function timestampConflict(a: ClaimDraft, b: ClaimDraft) {
  if (!a.timestamp_claimed || !b.timestamp_claimed) return null;
  const delta = Math.abs(Date.parse(a.timestamp_claimed) - Date.parse(b.timestamp_claimed));
  if (!Number.isFinite(delta) || delta < 60 * 60 * 1000) return null;
  // Only the SAME fact (same claim type) with different times is a conflict.
  // Different event types (e.g. container_release vs container_collection) are sequential and expected to differ.
  // A reusable container ID is not one event, and separate ledger lines (payments, invoices, charges) legitimately
  // carry different dates, so neither may raise a conflict.
  const ref = (a.event_reference ?? "").trim();
  const sameEvent = !!ref && ref === (b.event_reference ?? "").trim() && !CONTAINER_ID.test(ref);
  const type = a.claim_type ?? "";
  const sameFact = sameEvent && !!type && type === b.claim_type && type !== "TEXT_RECORD" && !LEDGER_TYPES.test(type);
  return sameFact ? "Conflicting timestamps differ by " + Math.round(delta / 3600000) + " hour(s)." : null;
}


export function normalizeClaimKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

// A CSV header line names columns; it is not evidence. Drop claims that repeat it verbatim.
export function csvHeaderLine(bytes: ArrayBuffer, fileType: string, filename: string): string | null {
  const isCsv = fileType === "text/csv" || /\.csv$/i.test(filename);
  if (!isCsv) return null;
  const first = new TextDecoder().decode(bytes).split(/\r?\n/)[0]?.trim() ?? "";
  return first || null;
}

// Verbs and boilerplate AI phrasings wrap every fact in; they carry no evidential weight.
const CLAIM_FILLER_TOKENS = new Set([
  "the", "a", "an", "of", "on", "at", "is", "was", "were", "are", "be", "been",
  "that", "this", "it", "its", "by", "for", "to", "in", "and", "or", "as", "per", "with", "from",
  "states", "state", "stated", "reports", "report", "reported", "lists", "list", "listed",
  "identifies", "identify", "identified", "shows", "show", "shown", "confirms", "confirm", "confirmed",
  "notes", "note", "noted", "records", "record", "recorded", "says", "said",
  "invoice", "invoiced", "document", "claim", "claims",
]);

// Content tokens: lowercase, punctuation trimmed, numbers de-commas'd, filler dropped,
// prefix-5 so inflections agree ("collection"/"collected" -> "colle", "expires"/"expiring" -> "expir").
function contentTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.split(/\s+/)) {
    let t = raw.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9:]+$/g, "");
    if (!t) continue;
    if (/^[0-9][0-9,]*(\.[0-9]+)?$/.test(t)) t = t.replace(/,/g, "");
    if (CLAIM_FILLER_TOKENS.has(t)) continue;
    // Only plain words are stemmed. Identifiers and numbers (container IDs, line references) keep every character,
    // otherwise two different containers such as CSNU8330251 and CSNU8457610 collapse into one token.
    out.add(t.length > 5 && !/\d/.test(t) ? t.slice(0, 5) : t);
  }
  return out;
}

function hasNumericAnchor(tokens: Set<string>): boolean {
  for (const t of tokens) if (/\d/.test(t)) return true;
  return false;
}

// A re-read of the same document phrases the same fact differently. Treat a candidate as a
// duplicate of a stored claim only when it is essentially a subset of it (containment) or the
// two nearly coincide (jaccard) - and they share a concrete anchor (number, date, id) so two
// different facts that merely share topic words never merge. Conflicting values keep different
// anchors or enough distinct tokens, so contradictions survive.
export function isSemanticDuplicate(a: string, b: string): boolean {
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  if (ta.size < 2 || tb.size < 2) return false;
  let overlap = 0;
  const shared = new Set<string>();
  for (const t of ta) if (tb.has(t)) { overlap++; shared.add(t); }
  if (overlap < 2) return false;
  // Differing values on BOTH sides (08:00 vs 14:00, 10 vs 11 October) means the claims
  // state the same kind of fact with different values: a potential contradiction, never a duplicate.
  const numA = [...ta].filter((t) => /\d/.test(t) && !tb.has(t));
  const numB = [...tb].filter((t) => /\d/.test(t) && !ta.has(t));
  if (numA.length && numB.length) return false;
  const containment = overlap / Math.min(ta.size, tb.size);
  // A claim whose entire content is restated inside the other is the same fact, however phrased
  // ("Invoice identifies container TCLU0000000." vs "The invoice identifies container TCLU0000000.").
  if (containment === 1) return true;
  // Partial overlap needs more evidence: several shared tokens and a concrete anchor.
  if (overlap < 4 || !hasNumericAnchor(shared)) return false;
  const jaccard = overlap / (ta.size + tb.size - overlap);
  return containment >= 0.85 || jaccard >= 0.7;
}

// Keep only claims that are new for (case, document): dedupe inside the batch and against stored rows.
export function filterNewClaims<T extends { claim_text: string }>(claims: T[], existingTexts: string[], headerLine?: string | null): T[] {
  const headerKey = headerLine ? normalizeClaimKey(headerLine) : null;
  const seen = new Set<string>(existingTexts.map(normalizeClaimKey));
  const keptTexts: string[] = [...existingTexts];
  const out: T[] = [];
  for (const claim of claims) {
    const key = normalizeClaimKey(claim.claim_text);
    if (!key || key === headerKey || seen.has(key)) continue;
    if (keptTexts.some((t) => isSemanticDuplicate(claim.claim_text, t))) continue;
    seen.add(key);
    keptTexts.push(claim.claim_text);
    out.push(claim);
  }
  return out;
}

export async function extractDocumentClaimsForPath(input: {
  documentId: string;
  noAi?: boolean;
  allowTestFallback?: boolean;
  caseId: string;
  tenantId: string;
  supabase: SupabaseClient;
  userId: string;
}) {
  const { data: doc, error: docError } = await input.supabase.from("documents").select("*").eq("id", input.documentId).eq("case_id", input.caseId).single();
  if (docError || !doc) throw docError ?? new Error("DOCUMENT_NOT_FOUND");

  const { data: blob, error: blobError } = await input.supabase.storage.from("case-documents").download(doc.file_path);
  if (blobError || !blob) throw new Error(doc.file_path.startsWith("demo/") ? "This is a sample document with no file attached — upload a real file to extract claims." : "Could not read the uploaded file.");
  assertDocumentSize(blob.size);
  const bytes = await blob.arrayBuffer();
  const plain = isPlainDocument(doc.file_type, doc.name);
  if (plain) plainTextClaims(await blob.text());
  const pdf = doc.file_type === "application/pdf" || /\.pdf$/i.test(doc.name);
  if (input.noAi && !plain && !pdf) throw new Error("No-AI mode accepts TXT, CSV or text-based PDF files.");
  let mode: "ai" | "text" | "text-fallback" | "pdf-text" | "pdf-text-fallback" = input.noAi ? (pdf ? "pdf-text" : "text") : "ai";
  let providerUsed = input.noAi ? "none" : resolveClaimAiProvider().kind as string;
  const importLines = async (): Promise<ClaimDraft[]> => {
    const rows = pdf ? await readPdfLines(bytes) : plainTextClaims(await blob.text()).map(text => ({ page_number: 1, text }));
    return rows.map(line => ({ page_number: line.page_number, claim_text: line.text, claim_type: "TEXT_RECORD", normalized_value: line.text,
      evidence_class: inferClass(doc.name), nature: "REPORTED", confidence: 0.55 }));
  };
  let claims: ClaimDraft[] = [];
  const fallbackErrors: string[] = [];
  const coverageWarnings: string[] = [];
  if (input.noAi) claims = await importLines();
  else {
    try { claims = await extractWithGemini(bytes, doc.file_type, doc.name, coverageWarnings); }
    catch (error) {
      let recovered = false;
      for (const provider of enabledFreeFallbacks(input.allowTestFallback)) {
        try { claims = await extractFreeFallback(provider, bytes, doc.file_type, doc.name, coverageWarnings); if (claims.length) { providerUsed = provider; recovered = true; break; } }
        catch (e) { fallbackErrors.push(provider + ": " + (e instanceof Error ? e.message : "failed").slice(0, 120)); /* bounded one attempt per enabled free provider, never paid retry */ }
      }
      if (!recovered) {
        if (plain || pdf) {
          try { claims = await importLines(); mode = pdf ? "pdf-text-fallback" : "text-fallback"; providerUsed = "none"; }
          catch (parseError) { throw new Error(PDF_AI_UNAVAILABLE + " " + (parseError instanceof Error ? parseError.message : "Could not read text.") + (fallbackErrors.length ? " [free provider: " + fallbackErrors.join("; ") + "]" : "")); }
        } else throw error;
      }
    }
  }

  if (!claims.length) throw new Error("NO_CLAIMS_EXTRACTED");

  // Re-running extraction on a document must not duplicate claims.
  // AI re-reads phrase the same facts differently, so exact-text dedupe is not enough:
  // for AI runs, first drop the document's still-unverified (PENDING) claims and their
  // open flags, then insert the fresh set. Verified and disputed claims are never touched.
  if (!input.noAi) {
    const { data: pendingRows, error: pendingError } = await input.supabase
      .from("extracted_claims").select("id")
      .eq("case_id", input.caseId).eq("document_id", input.documentId).eq("status", "PENDING");
    if (pendingError) throw pendingError;
    const pendingIds = (pendingRows ?? []).map((r: any) => String(r.id));
    if (pendingIds.length) {
      const inList = pendingIds.map((id) => `"${id}"`).join(",");
      await input.supabase.from("timeline_events").delete().in("provenance_id", pendingIds);
      await input.supabase.from("contradictions").delete().eq("case_id", input.caseId).eq("status", "FLAGGED")
        .or(`claim_a_id.in.(${inList}),claim_b_id.in.(${inList})`);
      const { error: delError } = await input.supabase.from("extracted_claims").delete().in("id", pendingIds);
      if (delError) throw delError;
    }
  }
  const header = csvHeaderLine(bytes, doc.file_type, doc.name);
  const { data: existingRows, error: existingError } = await input.supabase
    .from("extracted_claims").select("claim_text")
    .eq("case_id", input.caseId).eq("document_id", input.documentId);
  if (existingError) throw existingError;
  claims = filterNewClaims(claims, (existingRows ?? []).map((r: any) => String(r.claim_text ?? "")), header);
  if (!claims.length) {
    return { claims: [], count: 0, skippedDuplicates: true, mode, providerUsed };
  }

  const inserted: any[] = [];
  let seq = 0;
  for (const claim of claims) {
    seq += 1;
    const base = {
      tenant_id: input.tenantId,
      case_id: input.caseId,
      document_id: input.documentId,
      page_number: claim.page_number ?? null,
      claim_text: claim.claim_text,
      claim_type: claim.claim_type ?? null,
      normalized_value: claim.event_reference ? { source_value: claim.normalized_value ?? null, event_reference: claim.event_reference } : claim.normalized_value ?? null,
      evidence_class: claim.evidence_class || inferClass(doc.name),
      nature: claim.nature,
      status: "PENDING",
      confidence: claim.confidence ?? 0.7,
      timestamp_claimed: claim.timestamp_claimed ?? null,
    };
    // source_seq records reading order. If the column is not deployed yet, store without it rather than fail the analysis.
    const { data: row, error } = await insertClaimRow(input.supabase, base, seq);
    if (error) throw error;
    inserted.push(row);

    if (claim.timestamp_claimed) {
      await input.supabase.from("timeline_events").insert({
        tenant_id: input.tenantId,
        case_id: input.caseId,
        timestamp: claim.timestamp_claimed,
        title: claim.claim_text,
        source: doc.name,
        evidence_class: claim.evidence_class || inferClass(doc.name),
        nature: claim.nature,
        provenance_id: row.id,
      });
    }
  }

  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const description = timestampConflict(claims[i]!, claims[j]!);
      if (!description) continue;
      await input.supabase.from("contradictions").insert({
        tenant_id: input.tenantId,
        case_id: input.caseId,
        title: "Timestamp conflict · " + (claims[i]!.claim_type ?? "claim") + " vs " + (claims[j]!.claim_type ?? "claim"),
        description,
        claim_a_id: inserted[i]?.id ?? null,
        claim_b_id: inserted[j]?.id ?? null,
        status: "FLAGGED",
      });
    }
  }

  let discrepancyFlags = 0;
  let discrepancyPass: "ran" | "failed" | "skipped" = "skipped";
  let discrepancyError: string | undefined;
  for (const f of candidateDateMismatches(claims)) {
    await input.supabase.from("contradictions").insert({
      tenant_id: input.tenantId, case_id: input.caseId,
      title: "Possible date mismatch (rule-based candidate, unverified)",
      description: f.explanation + " (page " + (claims[f.a - 1]!.page_number ?? "?") + " vs page " + (claims[f.b - 1]!.page_number ?? "?") + ")",
      claim_a_id: inserted[f.a - 1]?.id ?? null, claim_b_id: inserted[f.b - 1]?.id ?? null, status: "FLAGGED",
    });
    discrepancyFlags++;
  }
  if (providerUsed === "gemini-test" && claims.length > 1) {
    try {
      for (const f of await findGeminiDiscrepancies(claims)) {
        const a = claims[f.a - 1]!, b = claims[f.b - 1]!;
        await input.supabase.from("contradictions").insert({
          tenant_id: input.tenantId, case_id: input.caseId,
          title: "Different figures or dates in the file: " + (f.kind === "DIFFERENT_DATES" ? "dates" : "figures"),
          description: f.explanation + " (page " + (a.page_number ?? "?") + " vs page " + (b.page_number ?? "?") + ")",
          claim_a_id: inserted[f.a - 1]?.id ?? null, claim_b_id: inserted[f.b - 1]?.id ?? null, status: "FLAGGED",
        });
        discrepancyFlags++;
      }
      discrepancyPass = "ran";
    } catch (e) { discrepancyPass = "failed"; discrepancyError = (e instanceof Error ? e.message : "failed").slice(0, 120); fallbackErrors.push("discrepancy pass: " + discrepancyError); }
  }

  const integrity = analysisStatus({ discrepancyPass, discrepancyError, fallbackErrors, coverageWarnings });
  // documents.extraction_status is part of the canonical pack payload, so the status reaches the pack with no schema change.
  const { error: statusError } = await input.supabase.from("documents").update({ extraction_status: encodeExtractionStatus(integrity) }).eq("id", input.documentId).eq("case_id", input.caseId);
  if (statusError) fallbackErrors.push("status not recorded on document: " + String(statusError.message ?? "error").slice(0, 100));
  await input.supabase.from("audit_log").insert({
    tenant_id: input.tenantId,
    case_id: input.caseId,
    actor_user_id: input.userId,
    action: "DOCUMENT_EXTRACTED",
    entity_type: "document",
    entity_id: input.documentId,
    payload: { claims: inserted.length, filename: doc.name, mode, providerUsed, discrepancyFlags, ...(fallbackErrors.length ? { fallbackErrors } : {}), ...(coverageWarnings.length ? { coverageWarnings } : {}) },
  });

  return { claims: inserted, count: inserted.length, mode, providerUsed, discrepancyFlags, analysisExtraction: integrity.extraction, analysisReview: integrity.review, analysisNotes: integrity.extractionNotes, reviewNote: integrity.reviewNote, ...(fallbackErrors.length ? { fallbackErrors } : {}), ...(coverageWarnings.length ? { coverageWarnings } : {}) };
}

export const extractionHealth = createServerFn({ method: "GET" }).handler(async () => {
  const provider = resolveClaimAiProvider();
  return {
    configured: provider.kind !== "none",
    provider: provider.kind,
    label: provider.label,
    model: provider.kind === "gateway" ? "openai/gpt-6-astra" : process.env["CLAIM_AI_MODEL"] || (provider.kind === "anthropic" ? "claude-3-5-sonnet-latest" : "gpt-4o-mini"),
  };
});
