import { describe, expect, it } from "vitest";
import { readBodyWithCap } from "@/routes/api/cctv/ingest";

function streamRequest(chunks: string[], contentLength?: number) {
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
      controller.close();
    },
  });
  const headers: Record<string, string> = {};
  if (contentLength !== undefined) headers["content-length"] = String(contentLength);
  return new Request("https://x.test/api/cctv/ingest", {
    method: "POST",
    headers,
    body: stream,
    duplex: "half",
  } as RequestInit);
}

describe("ingest body cap", () => {
  it("passes through a body under the cap", async () => {
    expect(await readBodyWithCap(streamRequest(["hello ", "world"]), 100)).toBe("hello world");
  });
  it("rejects a chunked stream that exceeds the cap with no Content-Length", async () => {
    expect(await readBodyWithCap(streamRequest(["a".repeat(60), "b".repeat(60)]), 100)).toBeNull();
  });
  it("rejects when the stream is bigger than a lying small Content-Length", async () => {
    expect(await readBodyWithCap(streamRequest(["x".repeat(500)], 10), 100)).toBeNull();
  });
  it("handles an empty body", async () => {
    expect(await readBodyWithCap(new Request("https://x.test", { method: "POST" }), 100)).toBe("");
  });
});
