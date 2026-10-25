import { z } from "zod";
export const matchInput = z
  .object({
    caseId: z.string().uuid(),
    claimAId: z.string().uuid(),
    claimBId: z.string().uuid(),
    eventReference: z.string().trim().min(3).max(200),
    rationale: z.string().trim().min(10).max(4000),
  })
  .refine((x) => x.claimAId !== x.claimBId, { message: "Select two distinct source claims" });
export interface ClassifiableClaim {
  claim_type?: string | null;
  timestamp_claimed?: string | null;
}
export interface MatchClaimRow extends ClassifiableClaim {
  id: string;
  normalized_value?: unknown;
  document_id?: string | null;
}
export interface MatchDocumentRow {
  id: string;
  source_party?: string | null;
}
export function classifyMatchedClaims(a: ClassifiableClaim, b: ClassifiableClaim) {
  if (!a.claim_type || a.claim_type !== b.claim_type || a.claim_type === "TEXT_RECORD")
    return {
      kind: "HUMAN_REVIEW",
      description:
        "Different counting bases or fact types require review; no timestamp contradiction inferred.",
    };
  if (!a.timestamp_claimed || !b.timestamp_claimed)
    return {
      kind: "MISSING_TIME",
      description: "A matched source lacks timestamp evidence; no time conflict inferred.",
    };
  const delta = Math.abs(Date.parse(a.timestamp_claimed) - Date.parse(b.timestamp_claimed));
  if (!Number.isFinite(delta))
    return { kind: "MISSING_TIME", description: "Timestamp cannot be verified." };
  if (delta >= 3600000)
    return {
      kind: "TIMESTAMP_CONFLICT",
      description: `Human-confirmed same physical event; source timestamps differ by ${delta / 3600000} hour(s).`,
    };
  return {
    kind: "NO_THRESHOLD_CONFLICT",
    description:
      "Source timestamps differ by less than the current one-hour detector threshold. This is not automatic verification or proof of exact agreement.",
  };
}
export function exactEventCandidates(claims: MatchClaimRow[], documents: MatchDocumentRow[]) {
  const docs = new Map(documents.map((d) => [d.id, d]));
  const groups = new Map<string, MatchClaimRow[]>();
  for (const c of claims) {
    // JSON column: any shape is possible at runtime (a string has been observed in
    // fixtures), so narrow before reading the one property this grouping needs.
    const nv = c.normalized_value;
    const ref =
      nv && typeof nv === "object"
        ? (nv as { event_reference?: unknown }).event_reference
        : undefined;
    if (
      typeof ref !== "string" ||
      ref.trim().length < 3 ||
      !c.claim_type ||
      c.claim_type === "TEXT_RECORD"
    )
      continue;
    const key = JSON.stringify([ref.trim(), c.claim_type]);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const candidates: { a: string; b: string; reference: string }[] = [];
  for (const [key, rows] of groups) {
    for (let i = 0; i < rows.length; i++)
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i],
          b = rows[j],
          da = a.document_id ?? "",
          db = b.document_id ?? "",
          pa = docs.get(da)?.source_party?.trim().toLowerCase(),
          pb = docs.get(db)?.source_party?.trim().toLowerCase();
        if (da !== db && pa && pb && pa !== pb) {
          candidates.push({ a: a.id, b: b.id, reference: JSON.parse(key)[0] });
          if (candidates.length >= 50) return candidates;
        }
      }
  }
  return candidates;
}
