import { describe, expect, it } from "vitest";
import { disputedClaimIds, disputedWindow, isDisputedClaim, isDisputeEvent } from "./dispute";

const contradictions = [
  { id: "x1", status: "FLAGGED", claim_a_id: "a", claim_b_id: "b" },
  { id: "x2", status: "RESOLVED", claim_a_id: "c", claim_b_id: "d" },
  { id: "x3", status: "FLAGGED", claim_a_id: null, claim_b_id: "e" },
];

describe("dispute marking", () => {
  it("collects claim ids from flagged contradictions only", () => {
    const ids = disputedClaimIds(contradictions);
    expect([...ids].sort()).toEqual(["a", "b", "e"]);
  });

  it("treats reviewer-disputed claims and contradiction-linked claims as disputed", () => {
    const ids = disputedClaimIds(contradictions);
    expect(isDisputedClaim({ id: "a", status: "VERIFIED" }, ids)).toBe(true);
    expect(isDisputedClaim({ id: "z", status: "DISPUTED" }, ids)).toBe(true);
    expect(isDisputedClaim({ id: "c", status: "VERIFIED" }, ids)).toBe(false);
    expect(isDisputedClaim({ id: "z", status: "PENDING" }, ids)).toBe(false);
  });

  it("computes the disputed window from disputed claim timestamps", () => {
    const ids = disputedClaimIds(contradictions);
    const claims = [
      { id: "a", status: "VERIFIED", timestamp_claimed: "2026-10-10T08:00:00Z" },
      { id: "b", status: "VERIFIED", timestamp_claimed: "2026-10-17T09:30:00Z" },
      { id: "z", status: "VERIFIED", timestamp_claimed: "2026-10-01T00:00:00Z" },
      { id: "e", status: "VERIFIED", timestamp_claimed: null },
    ];
    expect(disputedWindow(claims, ids)).toEqual({ start: Date.parse("2026-10-10T08:00:00Z"), end: Date.parse("2026-10-17T09:30:00Z") });
  });

  it("returns no window when no disputed claim carries a timestamp", () => {
    expect(disputedWindow([{ id: "e", status: "VERIFIED" }], disputedClaimIds(contradictions))).toBeNull();
    expect(disputedWindow([], new Set())).toBeNull();
  });

  it("links timeline events to disputed claims via provenance", () => {
    const ids = disputedClaimIds(contradictions);
    expect(isDisputeEvent({ provenance_id: "a" }, ids)).toBe(true);
    expect(isDisputeEvent({ provenance_id: "c" }, ids)).toBe(false);
    expect(isDisputeEvent({ provenance_id: null }, ids)).toBe(false);
    expect(isDisputeEvent({}, ids)).toBe(false);
  });
});
