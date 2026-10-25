import { describe, expect, it } from "vitest";
import { freeWorkspaceDailyAttemptCap } from "./extraction.functions";

describe("freeWorkspaceDailyAttemptCap", () => {
  it("defaults to 10 when unset", () => {
    delete process.env.CLAIM_FREE_WORKSPACE_DAILY_ATTEMPTS;
    expect(freeWorkspaceDailyAttemptCap()).toBe(10);
  });
  it("uses a valid configured value", () => {
    process.env.CLAIM_FREE_WORKSPACE_DAILY_ATTEMPTS = "25";
    expect(freeWorkspaceDailyAttemptCap()).toBe(25);
  });
  it("fails closed (0) on invalid config", () => {
    process.env.CLAIM_FREE_WORKSPACE_DAILY_ATTEMPTS = "abc";
    expect(freeWorkspaceDailyAttemptCap()).toBe(0);
    process.env.CLAIM_FREE_WORKSPACE_DAILY_ATTEMPTS = "-5";
    expect(freeWorkspaceDailyAttemptCap()).toBe(0);
    process.env.CLAIM_FREE_WORKSPACE_DAILY_ATTEMPTS = "0";
    expect(freeWorkspaceDailyAttemptCap()).toBe(0);
    delete process.env.CLAIM_FREE_WORKSPACE_DAILY_ATTEMPTS;
  });
});
