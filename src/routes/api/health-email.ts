import { createFileRoute } from "@tanstack/react-router";
import { invokeDailyHealthEmail } from "@/lib/ai-health-email";
import type { AiHealthReport } from "@/lib/ai-health";
import { freeWorkspaceDailyAttemptCap } from "@/lib/extraction.functions";

// Daily AI health email invocation (docs/AI-HEALTH-EMAIL.md). SAFE before the
// owner grant: disabled answers without touching credentials, auth or the DB.
// When enabled, an external cron (or pg_cron) POSTs with the existing
// LOVABLE_CRON_SECRET bearer; duplicate-send protection via atomic day claim
// (migration 20261025240000) + Resend idempotency key tied to the day. NOT an
// exactly-once guarantee (24h provider window, unknown outcomes).
async function handle(request: Request) {
  const result = await invokeDailyHealthEmail(request, process.env, {
    authenticate: async (req) => {
      const { authenticateCronRequest } = await import("@/integrations/supabase/cron-auth");
      return authenticateCronRequest(req);
    },
    claimDay: async (day) => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin.rpc("claim_health_email_day", { p_day: day });
      if (error || typeof data !== "string") return "unknown";
      return data;
    },
    completeDay: async (day, providerMessageId) => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.rpc("complete_health_email_day", {
        p_day: day,
        p_provider_message_id: providerMessageId ?? null,
      });
    },
    failDay: async (day, detail) => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.rpc("fail_health_email_day", { p_day: day, p_detail: detail ?? null });
    },
    loadReport: async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin.rpc("admin_get_ai_health");
      return error || !data ? null : (data as unknown as AiHealthReport);
    },
    dailyCap: () => freeWorkspaceDailyAttemptCap() || null,
  });
  return Response.json({ status: result.status }, { status: result.http });
}

export const Route = createFileRoute("/api/health-email")({
  server: { handlers: { POST: ({ request }) => handle(request) } },
});
