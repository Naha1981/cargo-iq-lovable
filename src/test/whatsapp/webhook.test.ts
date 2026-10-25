import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { handleWebhook, verifySignature, type WebhookDeps } from "@/lib/whatsapp/webhook.server";
const clock = Date.parse("2026-10-16T05:00:00Z");
const event = {
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: {
            metadata: { phone_number_id: "123456" },
            messages: [
              {
                id: "wamid.synthetic",
                from: "27820000000",
                type: "text",
                timestamp: String(clock / 1000),
                text: { body: "JHB to Durban, 10 tonnes, tautliner" },
              },
            ],
          },
        },
      ],
    },
  ],
};
const raw = JSON.stringify(event);
const sign = (s: string) =>
  "sha256=" + createHmac("sha256", "SYNTHETIC-secret").update(s).digest("hex");
const post = (s = raw, signature = sign(s)) =>
  new Request("https://example.invalid/api/whatsapp/webhook", {
    method: "POST",
    body: s,
    headers: { "x-hub-signature-256": signature },
  });
function deps() {
  const requests = new Map(),
    snapshots = new Map();
  let receives = 0;
  const d: WebhookDeps = {
    testIngestEnabled: true,
    appSecret: "SYNTHETIC-secret",
    verifyToken: "SYNTHETIC-verify",
    now: () => clock,
    findChannel: async () => ({ id: "channel", tenantId: "tenant", mode: "TEST", enabled: true }),
    receive: async (c, m, s) => {
      receives++;
      requests.set(m, requests.get(m) ?? { id: "request", sender: s });
      return "request";
    },
    rates: async () => [],
    snapshot: async (id, v, s, draft) => {
      if (!snapshots.has(id)) snapshots.set(id, { s, draft });
    },
  };
  return { d, requests, snapshots, count: () => receives };
}
describe("test-only webhook", () => {
  it("OFF returns404 without touching deps", async () => {
    const x = deps();
    x.d.testIngestEnabled = false;
    x.d.findChannel = async () => {
      throw Error("must not call");
    };
    expect((await handleWebhook(post(), x.d)).status).toBe(404);
    expect(x.requests.size).toBe(0);
  });
  it("signature covers raw bytes, not parsed JSON", () => {
    expect(verifySignature(Buffer.from(raw), sign(raw), "SYNTHETIC-secret")).toBe(true);
    expect(verifySignature(Buffer.from(raw + " "), sign(raw), "SYNTHETIC-secret")).toBe(false);
  });
  it("bad signature rejected before lookup", async () => {
    const x = deps();
    expect((await handleWebhook(post(raw, "sha256=" + "0".repeat(64)), x.d)).status).toBe(403);
    expect(x.count()).toBe(0);
  });
  it("GET verify token exact", async () => {
    expect(
      (
        await handleWebhook(
          new Request(
            "https://example.invalid?hub.mode=subscribe&hub.verify_token=SYNTHETIC-verify&hub.challenge=123",
          ),
          deps().d,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await handleWebhook(
          new Request(
            "https://example.invalid?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=123",
          ),
          deps().d,
        )
      ).status,
    ).toBe(403);
  });
  it("bounded body", async () =>
    expect((await handleWebhook(post("x".repeat(262145)), deps().d)).status).toBe(413));
  it("signed bad JSON rejected", async () =>
    expect((await handleWebhook(post("{"), deps().d)).status).toBe(400));
  it("signed null JSON rejected", async () =>
    expect((await handleWebhook(post("null"), deps().d)).status).toBe(400));
  it("one persisted draft, nothing outbound", async () => {
    const x = deps();
    const res = await handleWebhook(post(), x.d);
    expect(await res.json()).toEqual({ accepted: true, test_only: true, outbound_sent: false });
    expect(x.requests.size).toBe(1);
    expect(x.snapshots.size).toBe(1);
  });
  it("retries retain one snapshot using idempotent store", async () => {
    const x = deps();
    await handleWebhook(post(), x.d);
    await handleWebhook(post(), x.d);
    expect(x.requests.size).toBe(1);
    expect(x.snapshots.size).toBe(1);
  });
  it("unknown number not tenant selected from message text", async () => {
    const x = deps();
    x.d.findChannel = async () => null;
    expect((await handleWebhook(post(), x.d)).status).toBe(403);
    expect(x.count()).toBe(0);
  });
  it("DISABLED channel rejects", async () => {
    const x = deps();
    x.d.findChannel = async () => ({ id: "x", tenantId: "y", mode: "DISABLED", enabled: false });
    expect((await handleWebhook(post(), x.d)).status).toBe(403);
  });
  it("no old messages processed", async () => {
    const x = deps();
    x.d.now = () => clock + 86400001;
    await handleWebhook(post(), x.d);
    expect(x.count()).toBe(0);
  });
  it("DB failure is visible503 for retry", async () => {
    const x = deps();
    x.d.receive = async () => {
      throw Error("fail");
    };
    expect((await handleWebhook(post(), x.d)).status).toBe(503);
  });
  it("status-only callback creates no request", async () => {
    const x = deps();
    const s = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "wamid" }] } }] }],
    });
    expect((await handleWebhook(post(s), x.d)).status).toBe(200);
    expect(x.count()).toBe(0);
  });
});
