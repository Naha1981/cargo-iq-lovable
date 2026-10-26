import { describe, expect, it } from "vitest";
import { historicalReviewInput } from "./historical-review";
const valid = {
  caseId: "c0000000-0000-4000-8000-000000000001",
  requestId: "f0000000-0000-4000-8000-000000000001",
  date: "2025-12-03",
  place: "Candidate",
  lat: -29.856,
  lon: 31.041,
  confirmed: true,
};
describe("historical reference contribution input", () => {
  it("accepts reviewed case-bound filter only, strips supplied records", () => {
    const parsed = historicalReviewInput.parse({
      ...valid,
      records: [{ id: "foreign" }],
      actor: "forged",
    });
    expect(parsed).not.toHaveProperty("records");
    expect(parsed).not.toHaveProperty("actor");
  });
  it.each([
    { confirmed: false },
    { lat: NaN },
    { lat: 91 },
    { lon: Infinity },
    { place: "" },
    { caseId: "other" },
    { date: "yesterday" },
  ])("rejects invalid review %o", (change) => {
    expect(historicalReviewInput.safeParse({ ...valid, ...change }).success).toBe(false);
  });
});
