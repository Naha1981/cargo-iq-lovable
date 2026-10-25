// Cross-surface dispute marking. One case = one dispute; the disputed ITEMS are the claims
// tied to FLAGGED contradictions (plus any claim a reviewer marked DISPUTED). Every surface
// (documents, timeline, harbour map, ships) uses the same marker: the theme's --disputed red,
// an uppercase DISPUTED badge with a pulsing dot, and a shaded band for the disputed window.
export type ContradictionLike = {
  id: string;
  status: string;
  claim_a_id?: string | null;
  claim_b_id?: string | null;
};
export type ClaimLike = { id: string; status?: string | null; timestamp_claimed?: string | null };

export const DISPUTE_MARKER = {
  colorToken: "--disputed",
  cssColor: "oklch(0.68 0.2 25)",
  label: "DISPUTED",
} as const;

export function disputedClaimIds(contradictions: ContradictionLike[]): Set<string> {
  const ids = new Set<string>();
  for (const c of contradictions) {
    if (c.status !== "FLAGGED") continue;
    if (c.claim_a_id) ids.add(String(c.claim_a_id));
    if (c.claim_b_id) ids.add(String(c.claim_b_id));
  }
  return ids;
}

export function isDisputedClaim<T extends ClaimLike>(claim: T, disputed: Set<string>): boolean {
  return claim.status === "DISPUTED" || disputed.has(String(claim.id));
}

// The disputed window: the earliest-to-latest claimed timestamp among disputed claims.
export function disputedWindow(
  claims: ClaimLike[],
  disputed: Set<string>,
): { start: number; end: number } | null {
  const times = claims
    .filter((c) => isDisputedClaim(c, disputed))
    .map((c) => (c.timestamp_claimed ? Date.parse(c.timestamp_claimed) : NaN))
    .filter((t) => Number.isFinite(t));
  if (!times.length) return null;
  return { start: Math.min(...times), end: Math.max(...times) };
}

export function isDisputeEvent(
  event: { provenance_id?: string | null },
  disputed: Set<string>,
): boolean {
  return !!event.provenance_id && disputed.has(String(event.provenance_id));
}
