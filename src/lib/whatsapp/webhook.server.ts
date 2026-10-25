import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { ENGINE_VERSION, simulate, draftQuote, type Rate } from "./quote-engine";
export function verifySignature(raw: Uint8Array, header: string | null, secret: string): boolean {
  if (!secret || !header || !/^sha256=[a-f0-9]{64}$/.test(header)) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(header.slice(7), "hex"));
}
function equal(a: string, b: string): boolean {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export type WebhookDeps = {
  testIngestEnabled: boolean;
  appSecret: string;
  verifyToken: string;
  now: () => number;
  findChannel: (
    phoneId: string,
  ) => Promise<{ id: string; tenantId: string; mode: string; enabled: boolean } | null>;
  receive: (
    channelId: string,
    messageId: string,
    sender: string,
    sentAt: string,
    text: string,
    sha: string,
  ) => Promise<string>;
  rates: (tenantId: string) => Promise<Rate[]>;
  snapshot: (requestId: string, engine: string, snapshot: unknown, draft: string) => Promise<void>;
};
async function boundedBody(request: Request): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const x = await reader.read();
    if (x.done) break;
    total += x.value.byteLength;
    if (total > 262144) {
      await reader.cancel();
      throw new Error("SIZE");
    }
    chunks.push(x.value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const x of chunks) {
    all.set(x, offset);
    offset += x.length;
  }
  return all;
}
/** Deliberately no Graph API sender or access-token use. TEST only; default404. */
export async function handleWebhook(request: Request, d: WebhookDeps): Promise<Response> {
  if (!d.testIngestEnabled) return new Response("Not found", { status: 404 });
  if (request.method === "GET") {
    const u = new URL(request.url);
    if (
      !d.verifyToken ||
      u.searchParams.get("hub.mode") !== "subscribe" ||
      !equal(u.searchParams.get("hub.verify_token") ?? "", d.verifyToken)
    )
      return new Response("Forbidden", { status: 403 });
    const challenge = u.searchParams.get("hub.challenge") ?? "";
    return /^\d{1,64}$/.test(challenge)
      ? new Response(challenge)
      : new Response("Bad challenge", { status: 400 });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!d.appSecret) return new Response("Unavailable", { status: 503 });
  let raw: Uint8Array;
  try {
    raw = await boundedBody(request);
  } catch {
    return new Response("Payload too large", { status: 413 });
  }
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), d.appSecret))
    return new Response("Forbidden", { status: 403 });
  let event: any;
  try {
    event = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (
    !event ||
    typeof event !== "object" ||
    event.object !== "whatsapp_business_account" ||
    !Array.isArray(event.entry) ||
    event.entry.length > 20
  )
    return new Response("Invalid event", { status: 400 });
  const pending: any[] = [];
  for (const e of event.entry)
    for (const c of Array.isArray(e?.changes) ? e.changes : []) {
      if (!c || typeof c !== "object") return new Response("Invalid change", { status: 400 });
      if (c.field !== "messages") continue;
      const v = c.value;
      if (!v || !Array.isArray(v.messages)) continue; // status-only callbacks never generate replies
      const phoneId = v.metadata?.phone_number_id;
      if (typeof phoneId !== "string" || !/^\d{5,32}$/.test(phoneId) || v.messages.length > 50)
        return new Response("Invalid message batch", { status: 400 });
      const channel = await d.findChannel(phoneId);
      if (!channel || channel.mode !== "TEST" || !channel.enabled)
        return new Response("Unknown test channel", { status: 403 });
      for (const m of v.messages) {
        if (!m || typeof m !== "object") return new Response("Invalid message", { status: 400 });
        if (m.type !== "text") continue; // media is not fetched or interpreted
        if (
          typeof m.id !== "string" ||
          m.id.length < 1 ||
          m.id.length > 256 ||
          typeof m.from !== "string" ||
          !/^\d{6,16}$/.test(m.from) ||
          typeof m.text?.body !== "string" ||
          m.text.body.length > 4096 ||
          typeof m.timestamp !== "string" ||
          !/^\d{1,12}$/.test(m.timestamp)
        )
          return new Response("Invalid text event", { status: 400 });
        const ts = Number(m.timestamp) * 1000;
        if (ts > d.now() + 300000 || ts < d.now() - 86400000) continue;
        pending.push({ channel, m, ts });
      }
    }
  if (pending.length > 50) return new Response("Too many messages", { status: 400 });
  try {
    for (const { channel, m, ts } of pending) {
      const requestId = await d.receive(
        channel.id,
        m.id,
        m.from,
        new Date(ts).toISOString(),
        m.text.body,
        createHash("sha256").update(raw).digest("hex"),
      );
      const result = simulate(
        m.text.body,
        await d.rates(channel.tenantId),
        new Date(d.now()).toISOString(),
      );
      const draft = result.result
        ? draftQuote(result.result)
        : `DRAFT - NOT SENT. ${result.parsed.ok ? "Review required" : result.parsed.detail}`;
      await d.snapshot(requestId, ENGINE_VERSION, result, draft);
    }
  } catch {
    return new Response("Test ingest unavailable", { status: 503 });
  }
  return Response.json({ accepted: true, test_only: true, outbound_sent: false });
}
