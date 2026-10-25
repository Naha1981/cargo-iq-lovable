import { describe, expect, it } from "vitest";
import {
  csvHeaderLine,
  filterNewClaims,
  isSemanticDuplicate,
  normalizeClaimKey,
} from "./extraction.functions";

const csvBytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe("extraction dedupe", () => {
  it("normalizes claim keys", () => {
    expect(normalizeClaimKey("  Gate-in   at 18:00 ")).toBe("gate-in at 18:00");
  });

  it("drops the CSV header line from claims", () => {
    const header = csvHeaderLine(
      csvBytes("record_id,event,time\nSYN-1,gate_in,18:00\n"),
      "text/csv",
      "gate.csv",
    );
    const claims = [{ claim_text: "record_id,event,time" }, { claim_text: "SYN-1,gate_in,18:00" }];
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

  it("drops AI re-reads that rephrase a stored verified fact", () => {
    const stored = [
      "The invoice lists total due of ZAR 5,500.",
      "The invoiced demurrage rate is ZAR 2,750 per day.",
      "The invoice states that the container was collected on 17 October 2026 at 09:30.",
      "The invoice states free time of 5 calendar days, expiring on 15 October 2026 at 08:00.",
      "The invoice states that free time is 5 calendar days.",
      "The invoice states that discharge was completed on 10 October 2026 at 08:00.",
    ];
    const reRead = [
      { claim_text: "The invoice states a total due of ZAR 5,500." },
      { claim_text: "The invoice lists a demurrage rate of ZAR 2,750 per day." },
      { claim_text: "The invoice reports container collection on 17 October 2026 at 09:30." },
      { claim_text: "The invoice states free time expires on 15 October 2026 at 08:00." },
      { claim_text: "The invoice states free time of 5 calendar days." },
      { claim_text: "The invoice reports discharge completed on 10 October 2026 at 08:00." },
    ];
    expect(filterNewClaims(reRead, stored, null)).toEqual([]);
  });

  it("keeps distinct facts that share topic words", () => {
    const stored = ["The invoice charges 2 demurrage days."];
    const claims = [
      { claim_text: "The invoice lists a demurrage rate of ZAR 2,750 per day." },
      { claim_text: "The invoice is dated 17 October 2026." },
    ];
    const kept = filterNewClaims(claims, stored, null);
    expect(kept).toHaveLength(2);
  });

  it("never merges same-event claims with conflicting times", () => {
    const a = "The invoice states discharge completed on 10 October 2026 at 08:00.";
    const b = "The invoice states discharge completed on 10 October 2026 at 14:00.";
    expect(isSemanticDuplicate(a, b)).toBe(false);
  });

  it("dedupes rephrased repeats within a single batch", () => {
    const claims = [
      { claim_text: "The invoice lists total due of ZAR 5,500." },
      { claim_text: "The invoice states a total due of ZAR 5,500." },
    ];
    const kept = filterNewClaims(claims, [], null);
    expect(kept).toHaveLength(1);
  });

  it("drops short AI re-reads that restate a stored fact word for word", () => {
    const stored = [
      "The invoice identifies the port as Durban (ZADUR).",
      "The invoice identifies container TCLU0000000.",
      "The demurrage invoice number is INV-TEST-0001.",
    ];
    const reRead = [
      { claim_text: "Invoice identifies the port as Durban (ZADUR)." },
      { claim_text: "Invoice identifies container TCLU0000000." },
      { claim_text: "Demurrage invoice number is INV-TEST-0001." },
    ];
    expect(filterNewClaims(reRead, stored, null)).toEqual([]);
  });

  it("drops empty claims", () => {
    expect(filterNewClaims([{ claim_text: "   " }], [], null)).toEqual([]);
  });
});
