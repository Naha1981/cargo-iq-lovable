import { describe, it, expect } from "vitest";
import { readCatalogue } from "./catalogue-response";
describe("bounded catalogue input", () => {
  it("accepts valid provider GeoJSON", async () =>
    expect(
      await readCatalogue(
        new Response('{"features":[]}', { headers: { "content-type": "application/geo+json" } }),
      ),
    ).toEqual({ features: [] }));
  it.each(["text/html", "image/jpeg", ""])("refuses MIME %s", async (type) =>
    expect(
      readCatalogue(new Response('{"features":[]}', { headers: { "content-type": type } })),
    ).rejects.toThrow("content type"),
  );
  it("refuses declared size before reading", async () =>
    expect(
      readCatalogue(
        new Response("{}", {
          headers: { "content-type": "application/json", "content-length": "2000001" },
        }),
      ),
    ).rejects.toThrow("too large"));
  it("bounds unannounced streaming bytes", async () =>
    expect(
      readCatalogue(
        new Response(new Uint8Array(2000001), { headers: { "content-type": "application/json" } }),
      ),
    ).rejects.toThrow("too large"));
  it("refuses malformed structure", async () =>
    expect(
      readCatalogue(new Response("{}", { headers: { "content-type": "application/json" } })),
    ).rejects.toThrow("Invalid catalogue response"));
});
