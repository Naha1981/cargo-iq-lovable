import { describe, expect, it } from "vitest";
import { inferClass } from "@/lib/extraction.functions";

describe("inferClass filename classification", () => {
  it("classifies contracts", () => {
    expect(inferClass("contract-2026.pdf")).toBe("CONTRACTUAL");
    expect(inferClass("stevedore-agreement.pdf")).toBe("CONTRACTUAL");
  });
  it("classifies terminal and port documents as official/public", () => {
    expect(inferClass("terminal-notice.pdf")).toBe("OFFICIAL_PUBLIC");
    expect(inferClass("port-authority-tariff.pdf")).toBe("OFFICIAL_PUBLIC");
  });
  it("does not match substrings inside other words", () => {
    // Regression: substring matching sent these to OFFICIAL_PUBLIC via "port" in "report"/"transport".
    expect(inferClass("report.pdf")).toBe("CUSTOMER_PRIMARY");
    expect(inferClass("monthly-report-final.pdf")).toBe("CUSTOMER_PRIMARY");
    expect(inferClass("transport_invoice.pdf")).toBe("CUSTOMER_PRIMARY");
    expect(inferClass("export-list.pdf")).toBe("CUSTOMER_PRIMARY");
    expect(inferClass("supporting-docs.pdf")).toBe("CUSTOMER_PRIMARY");
  });
  it("is case-insensitive", () => {
    expect(inferClass("TERMINAL-Notice.PDF")).toBe("OFFICIAL_PUBLIC");
    expect(inferClass("Report.PDF")).toBe("CUSTOMER_PRIMARY");
  });
});
