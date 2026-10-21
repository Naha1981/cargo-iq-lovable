import { describe, expect, it } from "vitest";
import { assertDocumentSize, isPlainDocument, plainTextClaims } from "./extraction-policy";
describe("no-cost text extraction policy", () => {
  it("only offers plain text for no-AI import", () => {
    expect(isPlainDocument("text/csv", "record.csv")).toBe(true);
    expect(isPlainDocument("application/octet-stream", "record.TXT")).toBe(true);
    expect(isPlainDocument("application/pdf", "record.pdf")).toBe(false);
  });
  it("rejects oversized files", () => {
    expect(() => assertDocumentSize(5 * 1024 * 1024)).not.toThrow();
    expect(() => assertDocumentSize(5 * 1024 * 1024 + 1)).toThrow("over 5 MB");
  });
  it("imports lines without inventing events and refuses truncation", () => {
    expect(plainTextClaims(" one\n\n two ")).toEqual(["one", "two"]);
    expect(() => plainTextClaims("line\n".repeat(501))).toThrow("500 non-empty lines");
    expect(() => plainTextClaims("x".repeat(200001))).toThrow("200,000 characters");
  });
});
