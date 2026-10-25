import { describe, it, expect } from "vitest";
import { classifyMatchedClaims as c, exactEventCandidates } from "./cross-party-matches";
const a = { claim_type: "terminal_gate_in", timestamp_claimed: "2026-10-14T18:00:00Z" };
describe("confirmed event conflict semantics", () => {
  it("flags same-fact time difference >=1h", () =>
    expect(c(a, { ...a, timestamp_claimed: "2026-10-14T19:00:00Z" }).kind).toBe(
      "TIMESTAMP_CONFLICT",
    ));
  it("does not flag count-type differences", () =>
    expect(c(a, { ...a, claim_type: "truck_visit" }).kind).toBe("HUMAN_REVIEW"));
  it("missing time is missing, not proof", () =>
    expect(c(a, { ...a, timestamp_claimed: null }).kind).toBe("MISSING_TIME"));
  it("subthreshold does not auto verify", () =>
    expect(c(a, { ...a, timestamp_claimed: "2026-10-14T18:30:00Z" }).kind).toBe(
      "NO_THRESHOLD_CONFLICT",
    ));
  it("equivalent zones represent same instant", () =>
    expect(c(a, { ...a, timestamp_claimed: "2026-10-14T20:00:00+02:00" }).kind).toBe(
      "NO_THRESHOLD_CONFLICT",
    ));
});

it("suggests exact operation IDs across parties, never a same-type guess", () => {
  const docs = [
    { id: "d1", source_party: "Terminal" },
    { id: "d2", source_party: "Carrier" },
  ];
  const rows = [
    {
      id: "1",
      document_id: "d1",
      claim_type: "gate_in",
      normalized_value: { event_reference: "VISIT-1" },
    },
    {
      id: "2",
      document_id: "d2",
      claim_type: "gate_in",
      normalized_value: { event_reference: "VISIT-1" },
    },
    { id: "3", document_id: "d2", claim_type: "gate_in", normalized_value: "no identity" },
  ];
  expect(exactEventCandidates(rows, docs)).toEqual([{ a: "1", b: "2", reference: "VISIT-1" }]);
});
