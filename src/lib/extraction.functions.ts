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
};

function inferClass(name: string) {
  const n = name.toLowerCase();
  if (n.includes("contract") || n.includes("agreement")) return "CONTRACTUAL";
  if (n.includes("terminal") || n.includes("port")) return "OFFICIAL_PUBLIC";
  return "CUSTOMER_PRIMARY";
}

function parseJsonModel(text: string): ClaimDraft[] {
  const cleaned = text.replace(/^\`\`\`json\s*/i, "").replace(/^\`\`\`\s*$/i, "").trim();
  const parsed = JSON.parse(cleaned);
  const rows = Array.isArray(parsed) ? parsed : parsed.claims;
  if (!Array.isArray(rows)) throw new Error("EXTRACTION_JSON_SHAPE");
  return rows.map((row: any) => ({
    page_number: Number.isFinite(Number(row.page_number)) ? Number(row.page_number) : undefined,
    claim_text: String(row.claim_text ?? "").trim(),
    claim_type: row.claim_type ? String(row.claim_type) : undefined,
    normalized_value: row.normalized_value ?? row.value ?? null,
    evidence_class: String(row.evidence_class ?? "CUSTOMER_PRIMARY"),
    nature: ["OBSERVED","REPORTED","DERIVED","INFERRED"].includes(row.nature) ? row.nature : "REPORTED",
    confidence: Number.isFinite(Number(row.confidence)) ? Math.max(0, Math.min(1, Number(row.confidence))) : 0.7,
    timestamp_claimed: row.timestamp_claimed ? new Date(row.timestamp_claimed).toISOString() : undefined,
  })).filter((row: ClaimDraft) => row.claim_text.length > 0);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

async function extractWithGemini(bytes: ArrayBuffer, mimeType: string, filename: string) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY_NOT_CONFIGURED");
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const endpoint = "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(key);
  const binary = bytesToBase64(new Uint8Array(bytes));
  const prompt = [
    "You are CargoIQ's evidence extraction engine.",
    "Extract only facts anchored to the document. Never invent missing data.",
    "Return a JSON array. Each item: page_number, claim_text, claim_type, normalized_value, evidence_class, nature, confidence, timestamp_claimed.",
    "Use evidence_class CUSTOMER_PRIMARY unless clearly CONTRACTUAL or OFFICIAL_PUBLIC.",
    "Use OBSERVED for explicit facts, REPORTED for a party assertion, DERIVED only for arithmetic shown, INFERRED only where inference is explicit.",
    "Dates must be ISO-8601 when confident. Confidence is 0..1.",
    "Filename: " + filename,
  ].join("\n");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: binary } }] }],
      generationConfig: { responseMimeType: "application/json" },
    }),
  });
  if (!response.ok) throw new Error("GEMINI_" + response.status);
  const json = await response.json() as any;
  const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";
  return parseJsonModel(text);
}

function timestampConflict(a: ClaimDraft, b: ClaimDraft) {
  if (!a.timestamp_claimed || !b.timestamp_claimed) return null;
  const delta = Math.abs(Date.parse(a.timestamp_claimed) - Date.parse(b.timestamp_claimed));
  if (!Number.isFinite(delta) || delta < 60 * 60 * 1000) return null;
  const sameTheme = (a.claim_type && b.claim_type && a.claim_type === b.claim_type) || /available|release|gate|berth|discharge|free/i.test(a.claim_text + " " + b.claim_text);
  return sameTheme ? "Conflicting timestamps differ by " + Math.round(delta / 3600000) + " hour(s)." : null;
}

export async function extractDocumentClaimsForPath(input: {
  documentId: string;
  caseId: string;
  tenantId: string;
  supabase: SupabaseClient;
  userId: string;
}) {
  const { data: doc, error: docError } = await input.supabase.from("documents").select("*").eq("id", input.documentId).eq("case_id", input.caseId).single();
  if (docError || !doc) throw docError ?? new Error("DOCUMENT_NOT_FOUND");

  const { data: blob, error: blobError } = await input.supabase.storage.from("case-documents").download(doc.file_path);
  if (blobError || !blob) throw blobError ?? new Error("DOCUMENT_DOWNLOAD_FAILED");
  const bytes = await blob.arrayBuffer();

  let claims: ClaimDraft[] = [];
  try {
    claims = await extractWithGemini(bytes, doc.file_type, doc.name);
  } catch (error) {
    if (doc.file_type === "text/plain" || doc.name.toLowerCase().endsWith(".csv") || doc.name.toLowerCase().endsWith(".txt")) {
      const text = await blob.text();
      claims = text.split(/\r?\n/).map((line, index) => ({
        page_number: 1,
        claim_text: line.trim(),
        claim_type: "TEXT_RECORD",
        normalized_value: line.trim(),
        evidence_class: inferClass(doc.name),
        nature: "REPORTED" as const,
        confidence: 0.55,
      })).filter((x) => x.claim_text);
    } else throw error;
  }

  if (!claims.length) throw new Error("NO_CLAIMS_EXTRACTED");

  const inserted: any[] = [];
  for (const claim of claims) {
    const { data: row, error } = await input.supabase.from("extracted_claims").insert({
      tenant_id: input.tenantId,
      case_id: input.caseId,
      document_id: input.documentId,
      page_number: claim.page_number ?? null,
      claim_text: claim.claim_text,
      claim_type: claim.claim_type ?? null,
      normalized_value: claim.normalized_value ?? null,
      evidence_class: claim.evidence_class || inferClass(doc.name),
      nature: claim.nature,
      status: "PENDING",
      confidence: claim.confidence ?? 0.7,
      timestamp_claimed: claim.timestamp_claimed ?? null,
    }).select("*").single();
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

  await input.supabase.from("audit_log").insert({
    tenant_id: input.tenantId,
    case_id: input.caseId,
    actor_user_id: input.userId,
    action: "DOCUMENT_EXTRACTED",
    entity_type: "document",
    entity_id: input.documentId,
    payload: { claims: inserted.length, filename: doc.name },
  });

  return { claims: inserted, count: inserted.length };
}

export const extractionHealth = createServerFn({ method: "GET" }).handler(async () => ({
  configured: Boolean(process.env.GEMINI_API_KEY),
  model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
}));
