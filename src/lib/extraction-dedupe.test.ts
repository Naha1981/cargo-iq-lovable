import { describe, expect, it } from "vitest";
import { csvHeaderLine, filterNewClaims, normalizeClaimKey } from "./extraction.functions";

const csvBytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe("extraction dedupe", () => {
  it("normalizes claim keys", () => {
    expect(normalizeClaimKey("  Gate-in   at 18:00 ")).toBe("gate-in at 18:00");
  });

  it("drops the CSV header line from claims", () => {
    const header = csvHeaderLine(csvBytes("record_id,event,time\nSYN-1,gate_in,18:00\n"), "text/csv", "gate.csv");
    const claims = [
      { claim_text: "record_id,event,time" },
      { claim_text: "SYN-1,gate_in,18:00" },
    ];
    const kept = filterNewClaims(claims, [], header);
    expect(kept.map((c) => c.claim_text)).toEqual(["SYN-1,gate_in,18:00"]);
  });

  it("only treats csv files as having a header", () => {
    expect(csvHeaderLine(csvBytes("a,b\n"), "application/pdf", "doc.pdf")).toBeNull();
    expect(csvHeaderLine(csvBytes("a,b\n"), "text/plain", "notes.txt")).toBeNull();
  });

  it("skips claims already stored for the case and document", () => {
    const claims = [{ claim_text: "Duplicate fact" }, { claim_text: "New fact" }];
    const kept = filterNewClaims(claims, ["duplicate fact"], null);
    expect(kept.map((c) => c.claim_text)).toEqual(["New fact"]);
  });

  it("dedupes within a single batch", () => {
    const claims = [{ claim_text: "Same" }, { claim_text: " same  " }, { claim_text: "Other" }];
    const kept = filterNewClaims(claims, [], null);
    expect(kept.map((c) => c.claim_text)).toEqual(["Same", "Other"]);
  });

  it("drops empty claims", () => {
    expect(filterNewClaims([{ claim_text: "   " }], [], null)).toEqual([]);
  });
});
