import { describe, expect, it } from "vitest";
import { officialPreviewUrl, readOverview } from "./imagery-preview";
const url =
  "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/36/J/UM/2026/9/S2C_36JUM_20260909_0_L2A/preview.jpg";
describe("bounded official preview relay", () => {
  it("accepts known official overview only", () => expect(officialPreviewUrl(url)).toBe(url));
  it.each([
    url + "?x=1",
    url.replace("https:", "http:"),
    url.replace("sentinel-cogs.s3.us-west-2.amazonaws.com", "evil.invalid"),
    url.replace("preview.jpg", "TCI.tif"),
  ])("rejects untrusted or nonpreview %s", (u) => expect(() => officialPreviewUrl(u)).toThrow());
  it("accepts bounded JPEG marker bytes", async () =>
    expect(
      await readOverview(
        new Response(new Uint8Array([255, 216, 255, 217]), {
          headers: { "content-type": "image/jpeg" },
        }),
      ),
    ).toHaveLength(4));
  it("rejects fake MIME body", async () =>
    await expect(
      readOverview(new Response("not JPEG", { headers: { "content-type": "image/jpeg" } })),
    ).rejects.toThrow("Invalid JPEG"));
  it("rejects unsupported MIME", async () =>
    await expect(
      readOverview(new Response("x", { headers: { "content-type": "text/html" } })),
    ).rejects.toThrow());
  it("rejects declared oversize before reading", async () =>
    await expect(
      readOverview(
        new Response("x", {
          headers: { "content-type": "image/jpeg", "content-length": "300000" },
        }),
      ),
    ).rejects.toThrow("exceeds"));
  it("rejects streamed oversize without length", async () =>
    await expect(
      readOverview(
        new Response(new Uint8Array(250001), { headers: { "content-type": "image/jpeg" } }),
      ),
    ).rejects.toThrow("exceeds"));
  it("propagates aborted/error stream", async () =>
    await expect(
      readOverview(
        new Response(
          new ReadableStream({
            start(c) {
              c.error(new Error("aborted"));
            },
          }),
          { headers: { "content-type": "image/jpeg" } },
        ),
      ),
    ).rejects.toThrow("aborted"));
});
