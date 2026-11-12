import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("embedded visual evidence security headers", () => {
  const headers = readFileSync("public/_headers", "utf8");
  it("keeps application pages denied to framing", () => {
    expect(headers).toMatch(/\/\*\n(?: {2}.*\n)* {2}X-Frame-Options: DENY/);
  });
  for (const path of ["splat-sample", "splat-real-tree"]) {
    it(`allows only same-origin framing for ${path}`, () => {
      const block = headers.split(`/${path}/*\n`)[1]?.split("\n\n")[0];
      expect(block).toContain("X-Frame-Options: SAMEORIGIN");
      expect(block).toContain("Content-Security-Policy: frame-ancestors 'self'");
    });
  }
});
