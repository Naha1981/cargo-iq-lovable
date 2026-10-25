import { insertClaimRow } from "./claim-insert";
import {
  analysisStatus,
  candidateDateMismatches,
  encodeExtractionStatus,
} from "./analysis-integrity";
import { readPdfLines, readPdfPages } from "./pdf-text";
import {
  assertDocumentSize,
  isPlainDocument,
  plainTextClaims,
  PDF_AI_UNAVAILABLE,
} from "./extraction-policy";
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/integrations/supabase/types";

export type ClaimDraft = {
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

// Narrow provider/API response shapes - no `any` for wire payloads.
type OpenAiResponsesApi = {
  model?: string;
  usage?: { input_tokens?: number | null; output_tokens?: number | null };
  output_text?: string;
  output?: { content?: { type?: string; text?: string }[] }[];
};
type AnthropicMessagesApi = {
  model?: string;
  usage?: { input_tokens?: number | null; output_tokens?: number | null };
  content?: { type?: string; text?: string }[];
};
type GeminiGenerateResponse = {
  candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
};
type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };
type RawClaimRow = {
  page_number?: unknown;
  claim_text?: unknown;
  claim_type?: unknown;
  event_reference?: unknown;
  normalized_value?: unknown;
  value?: unknown;
  evidence_class?: unknown;
  nature?: unknown;
  confidence?: unknown;
  timestamp_claimed?: unknown;
};
type OpenAiContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "input_file"; filename: string; file_data: string };
type AnthropicContentPart =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: string; media_type: string; data: string } }
  | { type: "document"; source: { type: string; media_type: string; data: string } };
type ClaimInsertPayload = {
  page_number: number | null;
  claim_text: string;
  claim_type: string | null;
  normalized_value: unknown;
  evidence_class: string;
  nature: ClaimDraft["nature"];
  confidence: number;
  timestamp_claimed: string | null;
  event_reference?: string;
  source_name: string;
};
type InsertedClaimRow = { id: string } & Record<string, Json>;

// Match whole filename tokens, not substrings: "report.pdf" must not match "port".
export function inferClass(name: string) {
  const tokens = name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (tokens.includes("contract") || tokens.includes("agreement")) return "CONTRACTUAL";
  if (tokens.includes("terminal") || tokens.includes("port")) return "OFFICIAL_PUBLIC";
  return "CUSTOMER_PRIMARY";
}

const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
// A model may turn "February 2014" or "2012/2013" into 2014-02-01 or 2012-01-01. Keep a timestamp only when the claim
// itself states the day (an ISO date, "28 January", or "January 28"); otherwise the date stays in the text only.
export function dayAnchored(claimText: string, iso: string): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const day = d.getUTCDate(),
    mon = d.getUTCMonth();
  const isoPart = d.toISOString().slice(0, 10);
  if (claimText.includes(isoPart)) return true;
  const re = new RegExp(
    "\\b(?:(\\d{1,2})(?:st|nd|rd|th)?\\s+(" +
      MONTHS +
      ")\\b|(" +
      MONTHS +
      ")\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b)",
    "gi",
  );
  const names = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  for (const m of claimText.matchAll(re)) {
    const dd = Number(m[1] ?? m[4]),
      mm = String(m[2] ?? m[3])
        .toLowerCase()
        .slice(0, 3);
    if (dd === day && names.indexOf(mm) === mon) return true;
  }
  return false;
}

function parseJsonModel(text: string): ClaimDraft[] {
  const cleaned = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  const rows = Array.isArray(parsed) ? parsed : parsed.claims;
  if (!Array.isArray(rows)) throw new Error("EXTRACTION_JSON_SHAPE");
  const mapped = rows.map((row: RawClaimRow) => ({
    page_number: Number.isFinite(Number(row.page_number)) ? Number(row.page_number) : undefined,
    claim_text: String(row.claim_text ?? "").trim(),
    claim_type: row.claim_type ? String(row.claim_type) : undefined,
    event_reference: row.event_reference ? String(row.event_reference).trim() : undefined,
    normalized_value: row.normalized_value ?? row.value ?? null,
    evidence_class: String(row.evidence_class ?? "CUSTOMER_PRIMARY"),
    nature: ["OBSERVED", "REPORTED", "DERIVED", "INFERRED"].includes(String(row.nature))
      ? (String(row.nature) as ClaimDraft["nature"])
      : "REPORTED",
    confidence: Number.isFinite(Number(row.confidence))
      ? Math.max(0, Math.min(1, Number(row.confidence)))
      : 0.7,
    timestamp_claimed:
      typeof row.timestamp_claimed === "string" &&
      !isNaN(Date.parse(row.timestamp_claimed)) &&
      dayAnchored(String(row.claim_text ?? ""), String(row.timestamp_claimed))
        ? new Date(row.timestamp_claimed).toISOString()
        : undefined,
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
  type: "object",
  additionalProperties: false,
  required: ["claims"],
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "page_number",
          "claim_text",
          "claim_type",
          "value",
          "evidence_class",
          "nature",
          "confidence",
          "timestamp_claimed",
          "event_reference",
        ],
        properties: {
          page_number: { type: "integer" },
          claim_text: { type: "string" },
          claim_type: { type: "string" },
          value: { type: "string" },
          evidence_class: {
            type: "string",
            enum: ["CUSTOMER_PRIMARY", "CONTRACTUAL", "OFFICIAL_PUBLIC"],
          },
          nature: { type: "string", enum: ["OBSERVED", "REPORTED", "DERIVED", "INFERRED"] },
          confidence: { type: "number" },
          timestamp_claimed: { type: "string" },
          event_reference: { type: "string" },
        },
      },
    },
  },
};

export type ClaimAiProvider = { kind: "openai" | "anthropic" | "gateway" | "none"; label: string };

// Server-side only. Keys are read from the environment and never sent to the client.
export function resolveClaimAiProvider(): ClaimAiProvider {
  const openai = process.env["OPENAI_API_KEY"];
  const anthropic = process.env["ANTHROPIC_API_KEY"];
  const wanted = (process.env["CLAIM_AI_PROVIDER"] ?? "").toLowerCase();
  if (wanted && !["openai", "anthropic", "gateway", "free"].includes(wanted))
    throw new Error("Unknown CLAIM_AI_PROVIDER. Choose openai, anthropic, gateway, or free.");
  // Owner decision 25 Oct: free routes only until the first paying customer. "free" wins
  // over every configured key - no paid provider is called even if its key exists.
  if (wanted === "free")
    return {
      kind: "none",
      label: "Free routes only - paid AI disabled until the first paying customer",
    };
  if (wanted === "openai" && !openai)
    throw new Error("CLAIM_AI_PROVIDER is openai but OPENAI_API_KEY is not configured.");
  if (wanted === "anthropic" && !anthropic)
    throw new Error("CLAIM_AI_PROVIDER is anthropic but ANTHROPIC_API_KEY is not configured.");
  if (wanted === "gateway") {
    if (!process.env["LOVABLE_API_KEY"])
      throw new Error("CLAIM_AI_PROVIDER is gateway but LOVABLE_API_KEY is not configured.");
    return { kind: "gateway", label: "Using Lovable gateway" };
  }
  if (wanted === "anthropic" && anthropic)
    return { kind: "anthropic", label: "Using your own Anthropic key" };
  if (wanted === "openai" && openai) return { kind: "openai", label: "Using your own OpenAI key" };
  if (!wanted && openai) return { kind: "openai", label: "Using your own OpenAI key" };
  if (!wanted && anthropic) return { kind: "anthropic", label: "Using your own Anthropic key" };
  // No silent billed route: the gateway spends workspace AI credits, and credits are
  // money. It is selected only by an explicit CLAIM_AI_PROVIDER=gateway, and even then
  // the extraction call must pass the same reservation gate as own-key providers.
  // Lovable Cloud injects LOVABLE_API_KEY automatically; the key's mere presence must
  // never route a document to a billed provider.
  return { kind: "none", label: "No AI key configured" };
}

function paidModelForKind(kind: string): string {
  if (kind === "anthropic") return process.env["CLAIM_AI_MODEL"] || "claude-3-5-sonnet-latest";
  if (kind === "gateway") return GATEWAY_MODEL;
  return process.env["CLAIM_AI_MODEL"] || "gpt-4o-mini";
}

async function readError(res: Response, name: string) {
  const msg = await res.text().catch(() => "");
  if (res.status === 401)
    return new Error(name + " rejected the API key (401). Check the key set for this project.");
  // Provider-side hard spend limit (OpenAI project/org limit, or equivalent): this is the
  // monthly budget being reached, NOT a transient rate limit - say so plainly.
  if (res.status === 429 && /spend_limit_exceeded|billing_hard_limit|insufficient_quota/i.test(msg))
    return new Error(
      "AI_SPEND_LIMIT_REACHED: " +
        name +
        " reports the account spend limit is reached. Extraction continues on free/local routes only until the limit is raised.",
    );
  if (res.status === 402 || res.status === 403)
    return new Error(
      name + " refused the request (" + res.status + "). Check the key, billing and model access.",
    );
  if (res.status === 429) return new Error(name + " is rate limited - try again in a minute.");
  return new Error("AI_" + res.status + " " + msg.slice(0, 200));
}

// Set when a billed provider call is ABOUT TO START. Distinguishes "reservation made,
// no outbound request" (void is safe) from "outbound request attempted, consumption
// unknown" (never void: complete with the bound held, pending reconciliation).
let paidCallAttempted: { provider: string; model: string } | null = null;
// Set by the paid provider calls after a successful response; read by the orchestration
// to record usage accounting. Module state mirrors the error-capture pattern in this repo.
export let lastPaidUsage: {
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
} | null = null;

async function extractViaOpenAi(bytes: ArrayBuffer, mimeType: string, filename: string) {
  const key = process.env["OPENAI_API_KEY"]!;
  const isText = /^text\//.test(mimeType) || /\.(csv|txt)$/i.test(filename);
  const isImage = /^image\//.test(mimeType);
  const b64 = isText ? "" : bytesToBase64(new Uint8Array(bytes));
  const content: OpenAiContentPart[] = [{ type: "input_text", text: claimPrompt(filename) }];
  if (isText)
    content.push({
      type: "input_text",
      text: "DOCUMENT (page 1):\n" + new TextDecoder().decode(bytes).slice(0, 200000),
    });
  else if (isImage)
    content.push({ type: "input_image", image_url: `data:${mimeType};base64,${b64}` });
  else
    content.push({
      type: "input_file",
      filename,
      file_data: `data:${mimeType || "application/pdf"};base64,${b64}`,
    });
  paidCallAttempted = { provider: "openai", model: process.env["CLAIM_AI_MODEL"] || "gpt-4o-mini" };
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(45000),
    headers: { "content-type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({
      model: process.env["CLAIM_AI_MODEL"] || "gpt-4o-mini",
      store: false,
      input: [{ role: "user", content }],
      text: { format: { type: "json_schema", name: "claims", strict: true, schema: claimSchema } },
    }),
  });
  if (!res.ok) throw await readError(res, "OpenAI");
  const json = (await res.json()) as OpenAiResponsesApi;
  lastPaidUsage = {
    provider: "openai",
    model: String(json.model ?? (process.env["CLAIM_AI_MODEL"] || "gpt-4o-mini")),
    inputTokens: json.usage?.input_tokens ?? null,
    outputTokens: json.usage?.output_tokens ?? null,
  };
  const text =
    json.output_text ??
    (json.output ?? [])
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === "output_text")
      .map((c) => c.text)
      .join("");
  return parseJsonModel(String(text ?? "")).map((c) => ({
    ...c,
    timestamp_claimed: c.timestamp_claimed || undefined,
  }));
}

async function extractViaAnthropic(bytes: ArrayBuffer, mimeType: string, filename: string) {
  const key = process.env["ANTHROPIC_API_KEY"]!;
  const isText = /^text\//.test(mimeType) || /\.(csv|txt)$/i.test(filename);
  const isImage = /^image\//.test(mimeType);
  const b64 = isText ? "" : bytesToBase64(new Uint8Array(bytes));
  const content: AnthropicContentPart[] = [];
  if (isText)
    content.push({
      type: "text",
      text: "DOCUMENT (page 1):\n" + new TextDecoder().decode(bytes).slice(0, 200000),
    });
  else if (isImage)
    content.push({ type: "image", source: { type: "base64", media_type: mimeType, data: b64 } });
  else
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: b64 },
    });
  content.push({
    type: "text",
    text:
      claimPrompt(filename) +
      '\nReturn ONLY a JSON object of the form {"claims": [...]} where each claim has: page_number, claim_text, claim_type, value, evidence_class, nature, confidence, timestamp_claimed. No prose.',
  });
  paidCallAttempted = {
    provider: "anthropic",
    model: process.env["CLAIM_AI_MODEL"] || "claude-3-5-sonnet-latest",
  };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(45000),
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env["CLAIM_AI_MODEL"] || "claude-3-5-sonnet-latest",
      max_tokens: 8000,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) throw await readError(res, "Anthropic");
  const json = (await res.json()) as AnthropicMessagesApi;
  lastPaidUsage = {
    provider: "anthropic",
    model: String(json.model ?? (process.env["CLAIM_AI_MODEL"] || "claude-3-5-sonnet-latest")),
    inputTokens: json.usage?.input_tokens ?? null,
    outputTokens: json.usage?.output_tokens ?? null,
  };
  const text = (json.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
  const start = text.indexOf("{"),
    end = text.lastIndexOf("}");
  return parseJsonModel(start >= 0 && end > start ? text.slice(start, end + 1) : text).map((c) => ({
    ...c,
    timestamp_claimed: c.timestamp_claimed || undefined,
  }));
}

async function extractWholeDocument(bytes: ArrayBuffer, mimeType: string, filename: string) {
  const provider = resolveClaimAiProvider();
  if (provider.kind === "openai") return extractViaOpenAi(bytes, mimeType, filename);
  if (provider.kind === "anthropic") return extractViaAnthropic(bytes, mimeType, filename);
  if (provider.kind === "none")
    throw new Error(
      "AI_PAID_DISABLED: paid extraction is off (CLAIM_AI_PROVIDER=free). Falling back to free/local routes.",
    );
  return extractViaGateway(bytes, mimeType, filename);
}

// Price book for cost ESTIMATES only (USD per 1M tokens, input/output). Marked estimates:
// the provider invoice is the source of truth; this exists for cap enforcement headroom.
const MODEL_PRICES: Record<string, [number, number]> = {
  "gpt-4o-mini": [0.15, 0.6],
  "gemini-2.5-flash-lite": [0.1, 0.4],
  "claude-3-5-sonnet-latest": [3, 15],
};
export function estimateCostUsd(
  model: string,
  inputTokens: number | null,
  outputTokens: number | null,
): number | null {
  const p = MODEL_PRICES[model];
  if (!p || inputTokens == null || outputTokens == null) return null;
  return (inputTokens * p[0] + outputTokens * p[1]) / 1_000_000;
}

// Atomic spend reservation for paid extraction (migration 20261024220000). ONE database
// call reads the cap, sums the month (completed spend + outstanding reservations) and
// inserts a conservative UPPER-BOUND reservation, serialized per tenant - concurrent
// requests cannot race an almost-full cap. Reservations complete with actual usage after
// a successful call, are voided on known failure, and stale ones are voided hourly-side
// by reconcile_extraction_reservations(). FAIL CLOSED: when accounting is unavailable,
// paid extraction is refused - we cannot prove no cap exists, so we do not spend blind.
// When the cap check returns "no_cap", behavior is unchanged from before caps existed.
const GATEWAY_MODEL = "openai/gpt-6-astra";
const PAID_MAX_OUTPUT_TOKENS = 8000; // matches max_tokens on the own-key provider calls
const PAID_OUTPUT_TOKENS_GEMINI_STYLE = 8192;
function conservativeReservedCostUsd(model: string, estimatedInputTokens: number): number | null {
  // FAIL CLOSED: an unknown model rate is a refusal, not a guessed bound - the book max
  // is only an upper bound for models actually in the book.
  return estimateCostUsd(
    model,
    estimatedInputTokens,
    Math.max(PAID_MAX_OUTPUT_TOKENS, PAID_OUTPUT_TOKENS_GEMINI_STYLE),
  );
}
export async function reservePaidExtraction(
  supabase: SupabaseClient,
  tenantId: string,
  model: string,
  estimatedInputTokens: number,
): Promise<string | null> {
  const reservedCost = conservativeReservedCostUsd(model, estimatedInputTokens);
  if (reservedCost == null)
    throw new Error(
      "UNKNOWN_MODEL_RATE: no verified price for model " +
        model +
        " - refusing paid extraction rather than reserving blind.",
    );
  const requestId = crypto.randomUUID();
  const { data, error } = await supabase.rpc("reserve_extraction_cost", {
    p_tenant_id: tenantId,
    p_request_id: requestId,
    p_reserved_cost_usd: reservedCost,
  });
  if (error)
    throw new Error(
      "SPEND_ACCOUNTING_UNAVAILABLE: spend accounting is unavailable - refusing paid extraction rather than spending blind. " +
        String(error.message ?? "").slice(0, 80),
    );
  if (data === "over_cap")
    throw new Error(
      "AI_SPEND_CAP_REACHED: this workspace's monthly extraction cap is used (including reserved extractions in flight). Extraction continues on free/local routes only until the cap is raised.",
    );
  // A configured monthly cap IS the owner's grant for paid usage. "no_cap" means no
  // grant exists, so paid extraction stays off - it never silently re-enables spend.
  if (data !== "reserved")
    throw new Error(
      "PAID_NOT_ENABLED: no monthly extraction spend cap is configured for this workspace. Paid extraction stays off until the owner sets a cap (commercial_rules rule_type AI_SPEND_CAP).",
    );
  return requestId;
}
// Completion writes actual usage; when no usage was captured the RESERVED (upper-bound)
// amount is kept as the completed cost - never under-record. Errors never break extraction;
// they surface in fallbackErrors and the row stays reconcilable.
export async function completePaidExtraction(
  supabase: SupabaseClient,
  input: { tenantId: string; caseId: string; documentId: string },
  requestId: string,
  reservedCostUsd?: number,
): Promise<string | null> {
  const u = lastPaidUsage;
  lastPaidUsage = null;
  const { error } = await supabase.rpc("complete_extraction_cost", {
    p_tenant_id: input.tenantId,
    p_request_id: requestId,
    p_case_id: input.caseId,
    p_document_id: input.documentId,
    p_provider: u?.provider ?? "unknown",
    p_model: u?.model ?? null,
    p_input_tokens: u?.inputTokens ?? null,
    p_output_tokens: u?.outputTokens ?? null,
    p_cost_usd:
      (u ? estimateCostUsd(u.model, u.inputTokens, u.outputTokens) : null) ??
      reservedCostUsd ??
      null,
  });
  return error
    ? "usage completion failed (row remains reconcilable): " +
        String(error.message ?? "error").slice(0, 100)
    : null;
}
// Audit for REFUSED billed attempts. An actual outbound request always leaves an
// extraction_usage row (RESERVED or completed); a refusal must be visible too, and
// distinguishable from a real request: app_errors row with the EXTRACTION_SPEND_REFUSED
// marker, never an extraction_usage row. Best-effort, insert-only table, never blocks
// or alters the refusal itself.
async function logSpendRefusal(
  supabase: SupabaseClient,
  userId: string,
  provider: string,
  error: unknown,
): Promise<void> {
  try {
    const reason = error instanceof Error ? error.message : String(error);
    const message = ("EXTRACTION_SPEND_REFUSED provider=" + provider + " reason=" + reason).slice(
      0,
      1900,
    );
    await supabase
      .from("app_errors")
      .insert({ user_id: userId, route: "server:extract-claims", source: "server", message });
  } catch {
    /* best-effort audit only */
  }
}
export async function voidPaidExtraction(
  supabase: SupabaseClient,
  tenantId: string,
  requestId: string,
): Promise<void> {
  // Best-effort void: the daily reconciler also clears stale reservations, so a
  // transient failure here must not fail the extraction run.
  try {
    await supabase.rpc("void_extraction_reservation", {
      p_tenant_id: tenantId,
      p_request_id: requestId,
    });
  } catch {
    // Intentionally ignored.
  }
}

/**
 * Provider-neutral chunking for the configured production route. A long text PDF is read page by page in sections,
 * each sent through the same route as plain text with page tags. A failed section is retried once; if it still fails
 * its pages are reported in `warnings` (extraction INCOMPLETE) and the other sections are kept. Nothing is dropped silently.
 * Documents that fit one section, scanned PDFs and images keep the whole-document path.
 */
export async function extractChunked(
  call: (b: ArrayBuffer, mime: string, name: string) => Promise<ClaimDraft[]>,
  pages: string[],
  filename: string,
  warnings: string[],
): Promise<ClaimDraft[]> {
  const chunks = chunkPages(pages);
  if (chunks.length > GEMINI_MAX_CHUNKS) throw new Error("DOCUMENT_TOO_LONG_" + chunks.length);
  const all: ClaimDraft[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const text =
      "This is section " +
      (i + 1) +
      " of " +
      chunks.length +
      " of a longer document. Page numbers are in [page N] tags; use them as page_number.\n" +
      chunks[i];
    const bytes = new TextEncoder().encode(text).buffer as ArrayBuffer;
    const range = (chunks[i]!.match(/\[page (\d+)/g) ?? []).map((m) => m.replace("[page ", ""));
    const label = "pages " + (range[0] ?? "?") + "-" + (range[range.length - 1] ?? "?");
    let done = false;
    for (let attempt = 0; attempt < 2 && !done; attempt++) {
      try {
        all.push(...(await call(bytes, "text/plain", filename)));
        done = true;
      } catch (e) {
        if (attempt === 1)
          warnings.push(
            "section " +
              (i + 1) +
              "/" +
              chunks.length +
              " (" +
              label +
              ") failed: " +
              (e instanceof Error ? e.message : "error").slice(0, 100),
          );
      }
    }
  }
  if (!all.length) throw new Error("NO_SECTION_SUCCEEDED");
  const gaps = missingContainerIds(pages, all);
  if (gaps.length)
    warnings.push(
      "Container IDs in the source but not in any claim: " +
        gaps.map((g) => g.id + " (p" + g.page + ")").join(", "),
    );
  return all;
}

/** Name kept for history: this runs the configured production provider route (openai, anthropic or gateway), chunked for long PDFs. */
// A chunked document is N outbound calls, each with its own retry - one whole-doc
// reservation cannot bound that. Paid multi-section reading is refused until per-section
// reservation lands; free/local routes still apply. Exported for direct testing.
export function assertPaidChunkingSupported(chunkCount: number, kind: string): void {
  if (chunkCount > 1 && (kind === "openai" || kind === "anthropic" || kind === "gateway"))
    throw new Error(
      "PAID_MULTICHUNK_UNSUPPORTED: this PDF needs " +
        chunkCount +
        " sections; paid AI reading of multi-section documents is off until each section is reserved separately. Free/local routes still work.",
    );
}

export async function extractWithGemini(
  bytes: ArrayBuffer,
  mimeType: string,
  filename: string,
  warnings: string[] = [],
) {
  const isPdf = mimeType === "application/pdf" || /\.pdf$/i.test(filename);
  if (isPdf) {
    const pages = await readPdfPages(bytes).catch(() => [] as string[]);
    if (pages.length && chunkPages(pages).length > 1) {
      assertPaidChunkingSupported(chunkPages(pages).length, resolveClaimAiProvider().kind);
      return extractChunked(extractWholeDocument, pages, filename, warnings);
    }
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
  const content: OpenAiContentPart[] = [{ type: "input_text", text: prompt }];
  if (isText)
    content.push({
      type: "input_text",
      text: "DOCUMENT (page 1):\n" + new TextDecoder().decode(bytes).slice(0, 200000),
    });
  else if (isImage)
    content.push({ type: "input_image", image_url: `data:${mimeType};base64,${b64}` });
  else
    content.push({
      type: "input_file",
      filename,
      file_data: `data:${mimeType || "application/pdf"};base64,${b64}`,
    });

  paidCallAttempted = { provider: "gateway", model: GATEWAY_MODEL };
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(45000),
    headers: {
      "content-type": "application/json",
      "Lovable-API-Key": key,
      Authorization: `Bearer ${key}`,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: GATEWAY_MODEL,
      stream: true,
      store: false,
      reasoning: { effort: "low" },
      input: [{ role: "user", content }],
      text: { format: { type: "json_schema", name: "claims", strict: true, schema: claimSchema } },
    }),
  });
  if (!res.ok || !res.body) {
    const msg = await res.text().catch(() => "");
    if (res.status === 402)
      throw new Error("AI credits exhausted. Use TXT/CSV text mode without AI credits.");
    if (res.status === 429) throw new Error("AI is rate limited — try again in a minute.");
    throw new Error("AI_" + res.status + " " + msg.slice(0, 200));
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "",
    out = "";
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
        if (ev.type === "response.failed" || ev.type === "error")
          throw new Error(
            "AI_FAILED " + JSON.stringify(ev.error ?? ev.response?.error ?? "").slice(0, 200),
          );
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("AI_FAILED")) throw e;
      }
    }
  }
  lastPaidUsage = {
    provider: "gateway",
    model: GATEWAY_MODEL,
    inputTokens: null,
    outputTokens: null,
  };
  return parseJsonModel(out).map((c) => ({
    ...c,
    timestamp_claimed: c.timestamp_claimed || undefined,
  }));
}

// Every free provider is opt-in. Never silently route to a paid model or paid OCR plugin.
// Free third-party providers (Gemini free tier, OpenRouter free, Groq free plan) may receive
// ONLY documents the user explicitly classified "public_synthetic" for this extraction.
// Our customer-confidentiality rule (owner decision 25 Oct): confidential files never go to
// free AI APIs - without the explicit per-document classification, no free provider is called,
// no matter which env flags are set, and extraction falls back to local text import.
export function enabledFreeFallbacks(freeDataClass?: string) {
  if (freeDataClass !== "public_synthetic") return [];
  const providers: ("openrouter" | "groq" | "gemini-test")[] = [];
  if (
    process.env.CLAIM_OPENROUTER_FREE_FALLBACK_ENABLED === "true" &&
    process.env.OPENROUTER_API_KEY
  )
    providers.push("openrouter");
  if (process.env.CLAIM_GROQ_FREE_PLAN_CONFIRMED === "true" && process.env.GROQ_API_KEY)
    providers.push("groq");
  if (
    process.env.CLAIM_GEMINI_TEST_FALLBACK_ENABLED === "true" &&
    process.env.CLAIM_GEMINI_FREE_TIER_CONFIRMED === "true" &&
    process.env.GEMINI_API_KEY
  )
    providers.push("gemini-test");
  return providers;
}

// GLOBAL control for FREE provider ATTEMPTS (migrations 20261024221000 and 20261025200000):
// both the platform-wide daily default and the emergency off. Unset/empty = default 10
// attempts/day/workspace; "0" = free extraction OFF everywhere; set-but-invalid fails
// closed (0 = off). This global off overrides every per-workspace owner setting and is
// never silently overruled - the reserve RPC checks it before reading any workspace row.
// Per-workspace owner settings (owner panel, no deploy) sit beneath it: inherit / off /
// own limit 1..10000. Bounds actual outbound requests, not documents and not successful
// extractions; a slot is never refunded on failure.
export function freeWorkspaceDailyAttemptCap(): number {
  const raw = process.env.CLAIM_FREE_WORKSPACE_DAILY_ATTEMPTS;
  if (raw === undefined || raw.trim() === "") return 10;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
// Fail CLOSED on any enforcement gap: if the cap RPC is missing (migration not applied) or the
// check errors, no outbound free request is made. Free AI is simply OFF until enforcement is
// verifiably active - the cap is never represented as active when it is not.
type FreeSlot =
  | "reserved"
  | "over_cap"
  | "no_cap_configured"
  | "tenant_disabled"
  | "rpc_missing"
  | "check_failed";
async function reserveFreeAttempt(supabase: SupabaseClient, tenantId: string): Promise<FreeSlot> {
  try {
    const { data, error } = await supabase.rpc("reserve_free_extraction_attempt", {
      p_tenant_id: tenantId,
      p_daily_cap: freeWorkspaceDailyAttemptCap(),
    });
    if (error)
      return error.code === "PGRST202" || error.code === "42883" ? "rpc_missing" : "check_failed";
    return (data as FreeSlot) ?? "check_failed";
  } catch {
    return "check_failed";
  }
}
// Gate invoked immediately before EVERY actual outbound free-provider request. Throws when no
// request may be made (cap exhausted, cap unconfigured, or enforcement unavailable).
export type FreeAttemptGate = () => Promise<void>;

// Free Gemini test path. Model is configurable and defaults to Google's own "latest" alias for the
// flash-lite tier, so a retired dated model name cannot silently break extraction.
export const GEMINI_TEST_MODEL_DEFAULT = "gemini-flash-lite-latest";
export function geminiTestModel() {
  return (process.env.CLAIM_GEMINI_TEST_MODEL || GEMINI_TEST_MODEL_DEFAULT).replace(
    /^models\//,
    "",
  );
}
const GEMINI_CHUNK_CHARS = 12000;
const GEMINI_MAX_CHUNKS = 12;
export function chunkPages(pages: string[], maxChars = GEMINI_CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let cur = "";
  pages.forEach((text, i) => {
    const tagged = "[page " + (i + 1) + "]\n" + text + "\n";
    // A single oversized page is split on line boundaries but keeps its page tag.
    const parts: string[] = [];
    if (tagged.length <= maxChars) parts.push(tagged);
    else {
      let buf = "[page " + (i + 1) + "]\n";
      for (const line of text.split("\n")) {
        if (buf.length + line.length + 1 > maxChars && buf.length > 20) {
          parts.push(buf);
          buf = "[page " + (i + 1) + " continued]\n";
        }
        buf += line + "\n";
      }
      parts.push(buf);
    }
    for (const part of parts) {
      if (cur && cur.length + part.length > maxChars) {
        chunks.push(cur);
        cur = "";
      }
      cur += part;
    }
  });
  if (cur) chunks.push(cur);
  return chunks;
}
const GEMINI_KEYS =
  'Return ONLY a JSON object {"claims": [...]} where each claim has exactly these keys: page_number (integer), claim_text (string, one self-contained sentence naming who asserts it), claim_type (string), value (string), evidence_class (CUSTOMER_PRIMARY|CONTRACTUAL|OFFICIAL_PUBLIC), nature (OBSERVED|REPORTED|DERIVED|INFERRED), confidence (0..1), timestamp_claimed (ISO-8601 date or empty string), event_reference (string).';
const GEMINI_RESPONSE_SCHEMA = {
  type: "OBJECT",
  required: ["claims"],
  properties: {
    claims: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: [
          "page_number",
          "claim_text",
          "claim_type",
          "value",
          "evidence_class",
          "nature",
          "confidence",
          "timestamp_claimed",
          "event_reference",
        ],
        properties: {
          page_number: { type: "INTEGER" },
          claim_text: { type: "STRING" },
          claim_type: { type: "STRING" },
          value: { type: "STRING" },
          evidence_class: {
            type: "STRING",
            enum: ["CUSTOMER_PRIMARY", "CONTRACTUAL", "OFFICIAL_PUBLIC"],
          },
          nature: { type: "STRING", enum: ["OBSERVED", "REPORTED", "DERIVED", "INFERRED"] },
          confidence: { type: "NUMBER" },
          timestamp_claimed: { type: "STRING" },
          event_reference: { type: "STRING" },
        },
      },
    },
  },
};
async function geminiCall(
  parts: GeminiPart[],
  attempt = 0,
  onAttempt?: FreeAttemptGate,
): Promise<ClaimDraft[]> {
  try {
    return await geminiCallOnce(parts, onAttempt);
  } catch (e) {
    if (attempt < 1 && e instanceof SyntaxError) return geminiCall(parts, attempt + 1, onAttempt);
    throw e;
  }
}
async function geminiCallOnce(parts: GeminiPart[], onAttempt?: FreeAttemptGate) {
  await onAttempt?.();
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" +
      geminiTestModel() +
      ":generateContent",
    {
      method: "POST",
      signal: AbortSignal.timeout(60000),
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY!,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: GEMINI_RESPONSE_SCHEMA,
        },
      }),
    },
  );
  if (!res.ok) throw new Error("FREE_GEMINI_" + res.status);
  const json = (await res.json()) as GeminiGenerateResponse;
  const reason = json.candidates?.[0]?.finishReason;
  // A cut-off answer is invalid JSON; never accept a partial chunk as if it were complete.
  if (reason && reason !== "STOP") throw new Error("FREE_GEMINI_FINISH_" + reason);
  return parseJsonModel(
    (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join(""),
  );
}

// Completeness audit. A model can silently skip a table row, so every ISO-6346 shaped container ID that appears in
// the source text must appear in at least one extracted claim. Missing ones get one targeted re-read of just their lines.
const CONTAINER_IN_TEXT = /\b([A-Z]{4})\s?(\d{6}\s?\d)\b/g;
const normId = (x: string) => x.toUpperCase().replace(/\s+/g, "");
export function missingContainerIds(
  pages: string[],
  claims: { claim_text: string; normalized_value?: unknown }[],
): { id: string; page: number; lines: string[] }[] {
  const haystack = normId(
    claims
      .map(
        (c) =>
          c.claim_text + " " + (typeof c.normalized_value === "string" ? c.normalized_value : ""),
      )
      .join(" "),
  );
  const found = new Map<string, { page: number; lines: string[] }>();
  pages.forEach((text, i) =>
    text.split("\n").forEach((line) => {
      for (const m of line.matchAll(CONTAINER_IN_TEXT)) {
        const id = normId(m[1]! + m[2]!);
        const e = found.get(id) ?? { page: i + 1, lines: [] };
        if (!e.lines.includes(line)) e.lines.push(line);
        found.set(id, e);
      }
    }),
  );
  return [...found].filter(([id]) => !haystack.includes(id)).map(([id, v]) => ({ id, ...v }));
}
async function extractViaGeminiTest(
  bytes: ArrayBuffer,
  mimeType: string,
  filename: string,
  plain: boolean,
  warnings: string[] = [],
  onAttempt?: FreeAttemptGate,
): Promise<ClaimDraft[]> {
  const head = claimPrompt(filename) + "\n" + GEMINI_KEYS;
  if (plain)
    return geminiCall(
      [{ text: head }, { text: "DOCUMENT (page 1):\n" + new TextDecoder().decode(bytes) }],
      0,
      onAttempt,
    );
  const pages =
    mimeType === "application/pdf" || /\.pdf$/i.test(filename) || !mimeType
      ? await readPdfPages(bytes).catch(() => [] as string[])
      : [];
  if (!pages.length)
    return geminiCall(
      [
        { text: head },
        {
          inline_data: {
            mime_type: mimeType || "application/pdf",
            data: bytesToBase64(new Uint8Array(bytes)),
          },
        },
      ],
      0,
      onAttempt,
    );
  const chunks = chunkPages(pages);
  if (chunks.length > GEMINI_MAX_CHUNKS)
    throw new Error("FREE_GEMINI_DOCUMENT_TOO_LONG_" + chunks.length);
  const all: ClaimDraft[] = [];
  for (const chunk of chunks)
    all.push(
      ...(await geminiCall(
        [
          {
            text:
              head +
              "\nThis is one section of a longer document. Page numbers are given in [page N] tags.",
          },
          { text: "DOCUMENT SECTION:\n" + chunk },
        ],
        0,
        onAttempt,
      )),
    );
  const gaps = missingContainerIds(pages, all);
  if (gaps.length) {
    const lines = gaps.map((g) => "[page " + g.page + "]\n" + g.lines.join("\n")).join("\n");
    all.push(
      ...(await geminiCall(
        [
          {
            text:
              head +
              "\nThese lines were skipped in a first pass. Extract every fact in them, one claim per row or statement.",
          },
          { text: "DOCUMENT LINES:\n" + lines },
        ],
        0,
        onAttempt,
      )),
    );
    const still = missingContainerIds(pages, all);
    if (still.length)
      warnings.push(
        "Container IDs in the source but not in any claim: " +
          still.map((g) => g.id + " (p" + g.page + ")").join(", "),
      );
  }
  return all;
}

// Second pass over the extracted claims: ask which pairs give DIFFERENT figures or dates for the same thing.
// Every flag cites two real claim numbers; invalid or self-pairs are dropped, so nothing is invented.
// Flags stay FLAGGED for human review. Ledger lines (separate payments, invoices, charges) are not conflicts.
export type DiscrepancyFlag = { a: number; b: number; kind: string; explanation: string };
export function parseDiscrepancies(text: string, claimCount: number): DiscrepancyFlag[] {
  const parsed = JSON.parse(
    text
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim(),
  );
  const rows = Array.isArray(parsed) ? parsed : parsed.discrepancies;
  if (!Array.isArray(rows)) throw new Error("DISCREPANCY_JSON_SHAPE");
  const seen = new Set<string>();
  const out: DiscrepancyFlag[] = [];
  for (const r of rows) {
    const a = Number(r.claim_a),
      b = Number(r.claim_b);
    if (
      !Number.isInteger(a) ||
      !Number.isInteger(b) ||
      a === b ||
      a < 1 ||
      b < 1 ||
      a > claimCount ||
      b > claimCount
    )
      continue;
    const key = [Math.min(a, b), Math.max(a, b)].join("-");
    if (seen.has(key)) continue;
    seen.add(key);
    const explanation = String(r.explanation ?? "").trim();
    if (!explanation) continue;
    out.push({
      a,
      b,
      kind: String(r.kind ?? "DIFFERENT_FIGURES").slice(0, 40),
      explanation: explanation.slice(0, 400),
    });
  }
  return out;
}
async function findGeminiDiscrepancies(
  claims: ClaimDraft[],
  onAttempt?: FreeAttemptGate,
): Promise<DiscrepancyFlag[]> {
  const list = claims
    .map((c, i) => i + 1 + ". [p" + (c.page_number ?? "?") + "] " + c.claim_text)
    .join("\n")
    .slice(0, 60000);
  const prompt = [
    "You review extracted claims from a freight or shipping dispute file.",
    "Find every pair of claims where two figures, counts, dates or amounts are in tension: they are about the same group of items, the same document or the same event, but the numbers or dates differ, OR the source itself says it cannot reconcile them. Work through the claims carefully: list the container counts, invoice dates, amounts and event dates, then compare them.",
    "Do NOT flag separate ledger lines such as different payments, invoices or charges that merely have different dates or amounts. Do NOT flag claims that describe different events or different people's evidence on different subjects.",
    "Use only the numbered claims below. Never use outside knowledge. Say plainly what differs; do not say which is right unless a claim itself says so.",
    'Return ONLY JSON {"discrepancies":[{"claim_a":int,"claim_b":int,"kind":"DIFFERENT_FIGURES|DIFFERENT_DATES","explanation":"one sentence"}]}. Return an empty list when there are none.',
    "CLAIMS:\n" + list,
  ].join("\n");
  // Comparing many claims needs a stronger reasoning tier than extraction. Model is configurable; the default is Google's own alias.
  const model = (process.env.CLAIM_GEMINI_TEST_REVIEW_MODEL || "gemini-flash-latest").replace(
    /^models\//,
    "",
  );
  await onAttempt?.();
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
    {
      method: "POST",
      signal: AbortSignal.timeout(110000),
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY!,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 16000,
          responseMimeType: "application/json",
        },
      }),
    },
  );
  if (!res.ok) throw new Error("FREE_GEMINI_" + res.status);
  const json = (await res.json()) as GeminiGenerateResponse;
  if (json.candidates?.[0]?.finishReason && json.candidates[0].finishReason !== "STOP")
    throw new Error("FREE_GEMINI_FINISH_" + json.candidates[0].finishReason);
  return parseDiscrepancies(
    (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join(""),
    claims.length,
  );
}
async function extractFreeFallback(
  provider: "openrouter" | "groq" | "gemini-test",
  bytes: ArrayBuffer,
  mimeType: string,
  filename: string,
  warnings: string[] = [],
  onAttempt?: FreeAttemptGate,
) {
  const plain = isPlainDocument(mimeType, filename);
  if (provider === "gemini-test")
    return extractViaGeminiTest(bytes, mimeType, filename, plain, warnings, onAttempt);
  const text = plain
    ? new TextDecoder().decode(bytes)
    : (await readPdfLines(bytes))
        .map((line) => `[page ${line.page_number}] ${line.text}`)
        .join("\n");
  plainTextClaims(text);
  const isRouter = provider === "openrouter";
  await onAttempt?.();
  const res = await fetch(
    isRouter
      ? "https://openrouter.ai/api/v1/chat/completions"
      : "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      signal: AbortSignal.timeout(30000),
      headers: {
        "Content-Type": "application/json",
        Authorization:
          "Bearer " + (isRouter ? process.env.OPENROUTER_API_KEY : process.env.GROQ_API_KEY),
      },
      body: JSON.stringify({
        model: isRouter ? "openrouter/free" : "openai/gpt-oss-20b",
        temperature: 0,
        max_tokens: 8000,
        ...(isRouter ? { provider: { data_collection: "deny", zdr: true } } : {}),
        messages: [
          {
            role: "system",
            content: claimPrompt(filename) + '\nReturn ONLY a JSON object {"claims": [...]}.',
          },
          { role: "user", content: "DOCUMENT:\n" + text },
        ],
        response_format: { type: "json_object" },
      }),
    },
  );
  if (!res.ok) throw new Error("FREE_" + provider.toUpperCase() + "_" + res.status);
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
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
  const sameFact =
    sameEvent &&
    !!type &&
    type === b.claim_type &&
    type !== "TEXT_RECORD" &&
    !LEDGER_TYPES.test(type);
  return sameFact
    ? "Conflicting timestamps differ by " + Math.round(delta / 3600000) + " hour(s)."
    : null;
}

export function normalizeClaimKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

// A CSV header line names columns; it is not evidence. Drop claims that repeat it verbatim.
export function csvHeaderLine(
  bytes: ArrayBuffer,
  fileType: string,
  filename: string,
): string | null {
  const isCsv = fileType === "text/csv" || /\.csv$/i.test(filename);
  if (!isCsv) return null;
  const first = new TextDecoder().decode(bytes).split(/\r?\n/)[0]?.trim() ?? "";
  return first || null;
}

// Verbs and boilerplate AI phrasings wrap every fact in; they carry no evidential weight.
const CLAIM_FILLER_TOKENS = new Set([
  "the",
  "a",
  "an",
  "of",
  "on",
  "at",
  "is",
  "was",
  "were",
  "are",
  "be",
  "been",
  "that",
  "this",
  "it",
  "its",
  "by",
  "for",
  "to",
  "in",
  "and",
  "or",
  "as",
  "per",
  "with",
  "from",
  "states",
  "state",
  "stated",
  "reports",
  "report",
  "reported",
  "lists",
  "list",
  "listed",
  "identifies",
  "identify",
  "identified",
  "shows",
  "show",
  "shown",
  "confirms",
  "confirm",
  "confirmed",
  "notes",
  "note",
  "noted",
  "records",
  "record",
  "recorded",
  "says",
  "said",
  "invoice",
  "invoiced",
  "document",
  "claim",
  "claims",
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
  for (const t of ta)
    if (tb.has(t)) {
      overlap++;
      shared.add(t);
    }
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
export function filterNewClaims<T extends { claim_text: string }>(
  claims: T[],
  existingTexts: string[],
  headerLine?: string | null,
): T[] {
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
  // Explicit per-document data classification. Free third-party AI providers are called
  // only when this is exactly "public_synthetic"; anything else keeps documents local.
  freeDataClass?: "public_synthetic";
  caseId: string;
  tenantId: string;
  supabase: SupabaseClient;
  userId: string;
}) {
  const { data: doc, error: docError } = await input.supabase
    .from("documents")
    .select("*")
    .eq("id", input.documentId)
    .eq("case_id", input.caseId)
    .single();
  if (docError || !doc) throw docError ?? new Error("DOCUMENT_NOT_FOUND");

  const { data: blob, error: blobError } = await input.supabase.storage
    .from("case-documents")
    .download(doc.file_path);
  if (blobError || !blob)
    throw new Error(
      doc.file_path.startsWith("demo/")
        ? "This is a sample document with no file attached — upload a real file to extract claims."
        : "Could not read the uploaded file.",
    );
  assertDocumentSize(blob.size);
  const bytes = await blob.arrayBuffer();
  const plain = isPlainDocument(doc.file_type, doc.name);
  if (plain) plainTextClaims(await blob.text());
  const pdf = doc.file_type === "application/pdf" || /\.pdf$/i.test(doc.name);
  if (input.noAi && !plain && !pdf)
    throw new Error("No-AI mode accepts TXT, CSV or text-based PDF files.");
  let mode: "ai" | "text" | "text-fallback" | "pdf-text" | "pdf-text-fallback" = input.noAi
    ? pdf
      ? "pdf-text"
      : "text"
    : "ai";
  let providerUsed = input.noAi ? "none" : (resolveClaimAiProvider().kind as string);
  const importLines = async (): Promise<ClaimDraft[]> => {
    const rows = pdf
      ? await readPdfLines(bytes)
      : plainTextClaims(await blob.text()).map((text) => ({ page_number: 1, text }));
    // Raw imported lines carry NO assessed confidence: a fixed number would be invented
    // precision. The pack lists them separately as source material, never as claims.
    return rows.map((line) => ({
      page_number: line.page_number,
      claim_text: line.text,
      claim_type: "TEXT_RECORD",
      normalized_value: line.text,
      evidence_class: inferClass(doc.name),
      nature: "REPORTED" as const,
    }));
  };
  let claims: ClaimDraft[] = [];
  let freeGate: FreeAttemptGate | undefined;
  const fallbackErrors: string[] = [];
  const coverageWarnings: string[] = [];
  let reservationId: string | null = null;
  if (input.noAi) claims = await importLines();
  else {
    // App-side spend reservation before any billed call: own OpenAI/Anthropic keys AND
    // the Lovable gateway. Gateway calls bill workspace AI credits - credits are money,
    // so the same cap/reservation gate applies. The gateway model has no verified rate
    // in the price book, so the reservation refuses (UNKNOWN_MODEL_RATE) until the owner
    // adds a verified rate and sets a cap: no guessed prices, no blind credit spend.
    const resolvedProvider = resolveClaimAiProvider().kind;
    if (
      resolvedProvider === "openai" ||
      resolvedProvider === "anthropic" ||
      resolvedProvider === "gateway"
    )
      try {
        // Conservative input bound: 1 token per byte (chars/4 UNDERESTIMATES dense text).
        reservationId = await reservePaidExtraction(
          input.supabase,
          input.tenantId,
          paidModelForKind(resolvedProvider),
          bytes.byteLength,
        );
      } catch (error) {
        await logSpendRefusal(input.supabase, input.userId, resolvedProvider, error);
        throw error;
      }
    paidCallAttempted = null;
    try {
      claims = await extractWithGemini(bytes, doc.file_type, doc.name, coverageWarnings);
    } catch (error) {
      if (reservationId) {
        // Provider functions set this inside their own scope; an explicit type read keeps
        // TS from narrowing the module variable to null at the reset above.
        const attempted = paidCallAttempted as { provider: string; model: string } | null;
        if (attempted) {
          // An outbound billed request STARTED. Consumption is unknown - possibly partial.
          // Never void (that would release budget as if proved free): complete the row with
          // the reserved bound held as cost and tokens NULL, meaning "consumption unknown,
          // pending reconciliation". Distinct from a clean completion (tokens present) and
          // from a voided row (request never attempted).
          lastPaidUsage = {
            provider: attempted.provider,
            model: attempted.model,
            inputTokens: null,
            outputTokens: null,
          };
          const bound = conservativeReservedCostUsd(
            paidModelForKind(resolvedProvider),
            bytes.byteLength,
          );
          const note = await completePaidExtraction(
            input.supabase,
            input,
            reservationId,
            bound ?? undefined,
          );
          if (note) fallbackErrors.push(note);
        } else {
          // Reservation made but no outbound request was attempted: voiding is safe.
          await voidPaidExtraction(input.supabase, input.tenantId, reservationId);
        }
        paidCallAttempted = null;
        reservationId = null;
      }
      let recovered = false;
      // One gate per extraction run: every actual outbound free-provider request (per provider,
      // per chunk, per retry, per review pass) consumes one daily slot BEFORE it is sent.
      freeGate = async () => {
        const slot = await reserveFreeAttempt(input.supabase, input.tenantId);
        if (slot !== "reserved") throw new Error("FREE_ATTEMPT_" + slot.toUpperCase());
      };
      for (const provider of enabledFreeFallbacks(input.freeDataClass)) {
        try {
          claims = await extractFreeFallback(
            provider,
            bytes,
            doc.file_type,
            doc.name,
            coverageWarnings,
            freeGate,
          );
          if (claims.length) {
            providerUsed = provider;
            recovered = true;
            break;
          }
        } catch (e) {
          const m = e instanceof Error ? e.message : "failed";
          // Cap/enforcement states stop ALL free providers (no more outbound attempts) with a
          // plain reason each; local text-import recovery below is untouched.
          if (m === "FREE_ATTEMPT_OVER_CAP") {
            fallbackErrors.push(
              "free AI attempts for today are used up for this workspace - text import still works",
            );
            break;
          }
          if (m === "FREE_ATTEMPT_NO_CAP_CONFIGURED") {
            fallbackErrors.push(
              "free AI daily-attempt cap is not configured - free AI is off until it is",
            );
            break;
          }
          if (m === "FREE_ATTEMPT_TENANT_DISABLED") {
            fallbackErrors.push(
              "free AI extraction is turned off for this workspace - text import still works",
            );
            break;
          }
          if (m === "FREE_ATTEMPT_RPC_MISSING") {
            fallbackErrors.push(
              "free AI is off on this environment until the daily-attempt cap update is applied - text import still works",
            );
            break;
          }
          if (m === "FREE_ATTEMPT_CHECK_FAILED") {
            fallbackErrors.push(
              "could not verify the free daily attempt limit - free AI skipped for this document; try again or use text import",
            );
            break;
          }
          fallbackErrors.push(
            provider + ": " + m.slice(0, 120),
          ); /* bounded one attempt per enabled free provider, never paid retry */
        }
      }
      if (!recovered) {
        if (plain || pdf) {
          try {
            claims = await importLines();
            mode = pdf ? "pdf-text-fallback" : "text-fallback";
            providerUsed = "none";
          } catch (parseError) {
            throw new Error(
              PDF_AI_UNAVAILABLE +
                " " +
                (parseError instanceof Error ? parseError.message : "Could not read text.") +
                (fallbackErrors.length
                  ? " [free provider: " + fallbackErrors.join("; ") + "]"
                  : ""),
            );
          }
        } else throw error;
      }
    }
  }

  if (!claims.length) throw new Error("NO_CLAIMS_EXTRACTED");

  // Re-running extraction on a document must not duplicate claims.
  // AI re-reads phrase the same facts differently, so exact-text dedupe is not enough:
  // for AI runs, the document's still-unverified (PENDING) claims and their open flags
  // are replaced by the fresh set. Verified and disputed claims are never touched.
  const header = csvHeaderLine(bytes, doc.file_type, doc.name);
  const { data: existingRows, error: existingError } = await input.supabase
    .from("extracted_claims")
    .select("claim_text")
    .eq("case_id", input.caseId)
    .eq("document_id", input.documentId);
  if (existingError) throw existingError;
  claims = filterNewClaims(
    claims,
    (existingRows ?? []).map((r: { claim_text?: string | null }) => String(r.claim_text ?? "")),
    header,
  );
  if (!claims.length) {
    return { claims: [], count: 0, skippedDuplicates: true, mode, providerUsed };
  }

  const claimPayload = claims.map((claim) => ({
    page_number: claim.page_number ?? null,
    claim_text: claim.claim_text,
    claim_type: claim.claim_type ?? null,
    normalized_value: claim.normalized_value ?? null,
    evidence_class: claim.evidence_class || inferClass(doc.name),
    nature: claim.nature,
    confidence: claim.confidence ?? 0.7,
    timestamp_claimed: claim.timestamp_claimed ?? null,
    event_reference: claim.event_reference ?? undefined,
    source_name: doc.name,
  }));
  // One RPC (migration 20261024217000) does cleanup + inserts + provenance timeline in a
  // single transaction; until it is applied on an environment, the legacy multi-call path
  // runs so code and migration roll out in either order (PGRST202/42883 = RPC missing).
  let inserted: InsertedClaimRow[];
  // Older/test clients without rpc() go straight to the legacy path.
  const rpcCall =
    typeof input.supabase.rpc === "function"
      ? await input.supabase.rpc("replace_pending_claims", {
          _case_id: input.caseId,
          _document_id: input.documentId,
          _claims: claimPayload,
          _replace_pending: !input.noAi,
        })
      : { data: null, error: { code: "PGRST202" } };
  const { data: rpcRows, error: rpcError } = rpcCall as {
    data: unknown;
    error: { code?: string; message?: string } | null;
  };
  if (!rpcError) {
    inserted = (rpcRows ?? []) as InsertedClaimRow[];
  } else if (rpcError.code === "PGRST202" || rpcError.code === "42883") {
    if (!input.noAi) {
      // Re-extraction replaces unverified evidence. Without the transactional RPC the
      // only alternative is separate delete + insert calls, which can destroy PENDING
      // claims and their provenance if it dies half-way. Refuse loudly instead:
      // no deletes happen, existing evidence stays intact.
      throw new Error(
        "REEXTRACTION_UNAVAILABLE: re-running AI extraction needs database migration 20261024217000 " +
          "(atomic evidence replacement) applied first. No existing claims were changed.",
      );
    }
    // Import runs (noAi) only insert - non-destructive, safe on the legacy path.
    inserted = await legacyInsertClaims(input, doc, claimPayload);
  } else {
    throw rpcError;
  }

  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const description = timestampConflict(claims[i]!, claims[j]!);
      if (!description) continue;
      await input.supabase.from("contradictions").insert({
        tenant_id: input.tenantId,
        case_id: input.caseId,
        title:
          "Timestamp conflict · " +
          (claims[i]!.claim_type ?? "claim") +
          " vs " +
          (claims[j]!.claim_type ?? "claim"),
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
      tenant_id: input.tenantId,
      case_id: input.caseId,
      title: "Possible date mismatch (rule-based candidate, unverified)",
      description:
        f.explanation +
        " (page " +
        (claims[f.a - 1]!.page_number ?? "?") +
        " vs page " +
        (claims[f.b - 1]!.page_number ?? "?") +
        ")",
      claim_a_id: inserted[f.a - 1]?.id ?? null,
      claim_b_id: inserted[f.b - 1]?.id ?? null,
      status: "FLAGGED",
    });
    discrepancyFlags++;
  }
  if (providerUsed === "gemini-test" && claims.length > 1) {
    try {
      for (const f of await findGeminiDiscrepancies(claims, freeGate)) {
        const a = claims[f.a - 1]!,
          b = claims[f.b - 1]!;
        await input.supabase.from("contradictions").insert({
          tenant_id: input.tenantId,
          case_id: input.caseId,
          title:
            "Different figures or dates in the file: " +
            (f.kind === "DIFFERENT_DATES" ? "dates" : "figures"),
          description:
            f.explanation +
            " (page " +
            (a.page_number ?? "?") +
            " vs page " +
            (b.page_number ?? "?") +
            ")",
          claim_a_id: inserted[f.a - 1]?.id ?? null,
          claim_b_id: inserted[f.b - 1]?.id ?? null,
          status: "FLAGGED",
        });
        discrepancyFlags++;
      }
      discrepancyPass = "ran";
    } catch (e) {
      discrepancyPass = "failed";
      discrepancyError = (e instanceof Error ? e.message : "failed").slice(0, 120);
      fallbackErrors.push("discrepancy pass: " + discrepancyError);
    }
  }

  if (reservationId) {
    // Paid route succeeded and produced these claims: settle the reservation with actual usage.
    const usageNote = await completePaidExtraction(input.supabase, input, reservationId);
    if (usageNote) fallbackErrors.push(usageNote);
  }
  const integrity = analysisStatus({
    discrepancyPass,
    discrepancyError,
    fallbackErrors,
    coverageWarnings,
  });
  // documents.extraction_status is part of the canonical pack payload, so the status reaches the pack with no schema change.
  const { error: statusError } = await input.supabase
    .from("documents")
    .update({ extraction_status: encodeExtractionStatus(integrity) })
    .eq("id", input.documentId)
    .eq("case_id", input.caseId);
  if (statusError)
    fallbackErrors.push(
      "status not recorded on document: " + String(statusError.message ?? "error").slice(0, 100),
    );
  await input.supabase.from("audit_log").insert({
    tenant_id: input.tenantId,
    case_id: input.caseId,
    actor_user_id: input.userId,
    action: "DOCUMENT_EXTRACTED",
    entity_type: "document",
    entity_id: input.documentId,
    payload: {
      claims: inserted.length,
      filename: doc.name,
      mode,
      providerUsed,
      discrepancyFlags,
      ...(fallbackErrors.length ? { fallbackErrors } : {}),
      ...(coverageWarnings.length ? { coverageWarnings } : {}),
    },
  });

  return {
    claims: inserted,
    count: inserted.length,
    mode,
    providerUsed,
    discrepancyFlags,
    analysisExtraction: integrity.extraction,
    analysisReview: integrity.review,
    analysisNotes: integrity.extractionNotes,
    reviewNote: integrity.reviewNote,
    ...(fallbackErrors.length ? { fallbackErrors } : {}),
    ...(coverageWarnings.length ? { coverageWarnings } : {}),
  };
}

// Legacy pre-RPC path for import (noAi) runs only: insert calls, no deletes - importing
// never replaces evidence, so this path is non-destructive by construction.
async function legacyInsertClaims(
  input: Parameters<typeof extractDocumentClaimsForPath>[0],
  doc: { name: string },
  claimPayload: ClaimInsertPayload[],
): Promise<InsertedClaimRow[]> {
  const inserted: InsertedClaimRow[] = [];
  let seq = 0;
  for (const claim of claimPayload) {
    seq += 1;
    const base = {
      tenant_id: input.tenantId,
      case_id: input.caseId,
      document_id: input.documentId,
      page_number: claim.page_number ?? null,
      claim_text: claim.claim_text,
      claim_type: claim.claim_type ?? null,
      normalized_value: claim.event_reference
        ? { source_value: claim.normalized_value ?? null, event_reference: claim.event_reference }
        : (claim.normalized_value ?? null),
      evidence_class: claim.evidence_class,
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
        evidence_class: claim.evidence_class,
        nature: claim.nature,
        provenance_id: row.id,
      });
    }
  }
  return inserted;
}

export const extractionHealth = createServerFn({ method: "GET" }).handler(async () => {
  const provider = resolveClaimAiProvider();
  return {
    configured: provider.kind !== "none",
    provider: provider.kind,
    label: provider.label,
    model:
      provider.kind === "gateway"
        ? GATEWAY_MODEL
        : process.env["CLAIM_AI_MODEL"] ||
          (provider.kind === "anthropic" ? "claude-3-5-sonnet-latest" : "gpt-4o-mini"),
  };
});
