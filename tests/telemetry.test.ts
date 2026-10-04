import { describe, expect, test } from "bun:test";
import { sanitizeTelemetry } from "../src/lib/telemetry/sanitizer";

describe("privacy-first telemetry sanitizer", () => {
  test("keeps only contract-approved primitive fields", () => {
    const result = sanitizeTelemetry("workflow_completed", {
      workflow: "example_workflow",
      duration_ms: 1200,
      status: "success",
      unexpected: "drop-me",
    });

    expect(result?.properties).toEqual({
      workflow: "example_workflow",
      duration_ms: 1200,
      status: "success",
    });
  });

  test("blocks identifiers and sensitive keys", () => {
    const result = sanitizeTelemetry("workflow_failed", {
      workflow: "example_workflow",
      error_code: "E_TIMEOUT",
      component: "connector",
      retryable: true,
      patient_id: "12345",
      email: "person@example.com",
    });

    expect(result?.properties).toEqual({
      workflow: "example_workflow",
      error_code: "E_TIMEOUT",
      component: "connector",
      retryable: true,
    });
  });

  test("rejects nested objects instead of serialising application state", () => {
    const result = sanitizeTelemetry("app_opened", {
      product: "Test",
      environment: "production",
      platform: "web",
      nested: { anything: "unsafe" },
    });

    expect(result?.properties).toEqual({
      product: "Test",
      environment: "production",
      platform: "web",
    });
  });

  test("fails closed for unknown events", () => {
    expect(sanitizeTelemetry("not_allowed", {})).toBeNull();
  });
});
