import { describe, expect, it } from "vitest";
import {
  assertConfirmable,
  assertReviewTransition,
  comparisonAvailability,
  relateTimes,
  timeRelationLabel,
} from "./gehi";

describe("review status machine", () => {
  it("draft -> under_review -> confirmed; rejection reopenable", () => {
    expect(() => assertReviewTransition("draft", "under_review")).not.toThrow();
    expect(() => assertReviewTransition("under_review", "confirmed")).not.toThrow();
    expect(() => assertReviewTransition("rejected", "under_review")).not.toThrow();
    expect(() => assertReviewTransition("confirmed", "under_review")).toThrow();
    expect(() => assertReviewTransition("draft", "confirmed")).toThrow();
  });
});

describe("assertConfirmable", () => {
  it("requires under_review AND recorded rationale", () => {
    expect(() => assertConfirmable({ review_status: "draft", rationale: "x" })).toThrow(
      /CONFIRM_REQUIRES_REVIEW/,
    );
    expect(() => assertConfirmable({ review_status: "under_review", rationale: "  " })).toThrow(
      /CONFIRM_REQUIRES_RATIONALE/,
    );
    expect(() =>
      assertConfirmable({
        review_status: "under_review",
        rationale: "Matches two independent port feeds",
      }),
    ).not.toThrow();
  });
});

describe("relateTimes honesty", () => {
  it("distinguishes before/during/after and missing", () => {
    expect(relateTimes("2026-10-20T10:00:00Z", "2026-10-20T10:30:00Z").kind).toBe("simultaneous");
    expect(relateTimes("2026-10-20T10:00:00Z", "2026-10-19T10:00:00Z").kind).toBe(
      "observation_before_event",
    );
    expect(relateTimes("2026-10-20T10:00:00Z", "2026-10-22T16:00:00Z").kind).toBe(
      "observation_after_event",
    );
    expect(relateTimes(undefined, "2026-10-20T10:00:00Z").kind).toBe("unknown");
    expect(
      timeRelationLabel(relateTimes("2026-10-20T10:00:00Z", "2026-10-22T16:00:00Z")),
    ).toContain("AFTER the event - later observation");
  });
});

describe("comparisonAvailability", () => {
  const cov = { covered: true, provider: "p" };
  const gap = { covered: false };
  it("available only when BOTH dates have real coverage", () => {
    expect(comparisonAvailability(cov, cov).available).toBe(true);
    expect(comparisonAvailability(gap, cov).available).toBe(false);
    expect(comparisonAvailability(cov, gap).available).toBe(false);
    expect(comparisonAvailability(gap, gap).available).toBe(false);
    expect(comparisonAvailability(gap, cov).reason).toContain("earlier date");
  });
});
