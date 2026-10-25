import { createFileRoute } from "@tanstack/react-router";
import { handleWebhook, type WebhookDeps } from "@/lib/whatsapp/webhook.server";
import { rateFromRow } from "@/lib/whatsapp/rows";
async function handle(request: Request) {
  // No credentials or DB connection read at all in default OFF state.
  if (process.env["CARGOIQ_WA_TEST_INGEST"] !== "true")
    return new Response("Not found", { status: 404 });
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env["SUPABASE_URL"] || import.meta.env.VITE_SUPABASE_URL;
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) return new Response("Unavailable", { status: 503 });
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const d: WebhookDeps = {
    testIngestEnabled: true,
    appSecret: process.env["WA_META_APP_SECRET"] ?? "",
    verifyToken: process.env["WA_WEBHOOK_VERIFY_TOKEN"] ?? "",
    now: () => Date.now(),
    findChannel: async (phoneId) => {
      const { data, error } = await db
        .from("wa_channels")
        .select("id,tenant_id,mode,ingest_enabled")
        .eq("phone_number_id", phoneId)
        .maybeSingle();
      if (error) throw error;
      return data
        ? { id: data.id, tenantId: data.tenant_id, mode: data.mode, enabled: data.ingest_enabled }
        : null;
    },
    receive: async (channelId, messageId, sender, sentAt, text, sha) => {
      const { data, error } = await db.rpc("wa_receive_test", {
        p_channel: channelId,
        p_message: messageId,
        p_sender: sender,
        p_sent: sentAt,
        p_text: text,
        p_sha: sha,
      });
      if (error) throw error;
      return data;
    },
    rates: async (tenantId) => {
      const { data, error } = await db.rpc("wa_current_rate_rows", { p_tenant: tenantId });
      if (error) throw error;
      if ((data ?? []).length > 500) throw new Error("WA_RATE_CARD_TOO_LARGE");
      return (data ?? []).map(rateFromRow);
    },
    snapshot: async (requestId, engine, snapshot, draft) => {
      const { error } = await db.rpc("wa_save_test_snapshot", {
        p_request: requestId,
        p_engine: engine,
        p_snapshot: snapshot,
        p_draft: draft,
      });
      if (error) throw error;
    },
  };
  try {
    return await handleWebhook(request, d);
  } catch {
    return new Response("Test ingest unavailable", { status: 503 });
  }
}
export const Route = createFileRoute("/api/whatsapp/webhook")({
  server: {
    handlers: { GET: ({ request }) => handle(request), POST: ({ request }) => handle(request) },
  },
});
