import { describe, expect, it } from "vitest";
import {
  isTransientUploadError,
  UPLOAD_IDEMPOTENCY_WINDOW_MS,
  UPLOAD_MAX_ATTEMPTS,
  UPLOAD_NOT_CONFIRMED_MESSAGE,
  parseUploadConcurrency,
  parseUploadSlotTtl,
  UPLOAD_RETRY_DELAY_MS,
  UPLOAD_SERVER_BUSY_MESSAGE,
} from "./upload-backpressure";

describe("isTransientUploadError", () => {
  it("retries rate limits and server faults", () => {
    expect(isTransientUploadError({ status: 429 })).toBe(true);
    expect(isTransientUploadError({ statusCode: "500" })).toBe(true);
    expect(isTransientUploadError({ statusCode: "503" })).toBe(true);
  });
  it("never retries 403: burst-403 causality is unresolved and a permanent authorization failure is not transient", () => {
    expect(isTransientUploadError({ statusCode: "403" })).toBe(false);
    expect(isTransientUploadError({ statusCode: 403 })).toBe(false);
  });
  it("retries network failures", () => {
    expect(isTransientUploadError({ message: "Failed to fetch" })).toBe(true);
    expect(
      isTransientUploadError({ message: "NetworkError when attempting to fetch resource." }),
    ).toBe(true);
  });
  it("does not retry validation or policy rejections", () => {
    expect(isTransientUploadError({ statusCode: "400" })).toBe(false);
    expect(isTransientUploadError({ statusCode: "413" })).toBe(false);
    expect(isTransientUploadError({ message: "DOCUMENT_TOO_LARGE" })).toBe(false);
  });
  it("does not retry empty or unknown errors", () => {
    expect(isTransientUploadError({})).toBe(false);
    expect(isTransientUploadError({ message: "" })).toBe(false);
    expect(isTransientUploadError({ statusCode: "abc" })).toBe(false);
  });
});

describe("upload backpressure config", () => {
  it("bounds automatic retries to one extra attempt", () => {
    expect(UPLOAD_MAX_ATTEMPTS).toBe(2);
    expect(UPLOAD_RETRY_DELAY_MS).toBeGreaterThan(0);
    expect(UPLOAD_IDEMPOTENCY_WINDOW_MS).toBe(15 * 60 * 1000);
  });
  it("states the outcome is unconfirmed and retrying the same file is safe", () => {
    expect(UPLOAD_NOT_CONFIRMED_MESSAGE).toContain("not confirmed");
    expect(UPLOAD_NOT_CONFIRMED_MESSAGE.toLowerCase()).toContain("check the document list");
    // No unqualified "safe to retry" claim while the concurrent duplicate
    // window and the cleanup TOCTOU are still open.
    expect(UPLOAD_NOT_CONFIRMED_MESSAGE.toLowerCase()).not.toContain("safe");
  });
});

describe("upload admission seam", () => {
  it("busy message is truthful: nothing was uploaded", () => {
    expect(UPLOAD_SERVER_BUSY_MESSAGE).toContain("not uploaded");
    expect(UPLOAD_SERVER_BUSY_MESSAGE.toLowerCase()).not.toContain("safe");
  });
  it("parses concurrency controls: positive integer binds, everything else is unbounded", () => {
    expect(parseUploadConcurrency("5")).toBe(5);
    expect(parseUploadConcurrency(undefined)).toBeNull();
    expect(parseUploadConcurrency("")).toBeNull();
    expect(parseUploadConcurrency("0")).toBeNull();
    expect(parseUploadConcurrency("-3")).toBeNull();
    expect(parseUploadConcurrency("abc")).toBeNull();
  });
  it("parses the slot TTL with a floor of 30 seconds and a caller default", () => {
    expect(parseUploadSlotTtl(undefined, 300)).toBe(300);
    expect(parseUploadSlotTtl("10", 300)).toBe(300);
    expect(parseUploadSlotTtl("120", 300)).toBe(120);
  });
});
