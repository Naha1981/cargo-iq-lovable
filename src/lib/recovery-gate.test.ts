import { describe, expect, it } from "vitest";
import { caseRecovery } from "./recovery-gate";
describe("case register recovery gate", () => {
  it("hides the stale demo recovery while contradictions remain", () => {
    expect(caseRecovery(52800, 33600, 2)).toBeNull();
    expect(caseRecovery(52800, 33600, 1)).toBeNull();
  });
  it("keeps clear cases and non-negative recovery unchanged", () => {
    expect(caseRecovery(52800, 33600, 0)).toBe(19200);
    expect(caseRecovery(100, 200, 0)).toBe(0);
  });
});
