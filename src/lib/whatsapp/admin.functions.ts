import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { tenantMiddleware } from "@/lib/auth-middleware";
import { parseRateCsv } from "./rate-csv";
import { rateFromRow } from "./rows";
import { simulate, draftQuote } from "./quote-engine";
function admin(context: any) {
  if (context.role !== "admin") throw new Error("WA_ADMIN_REQUIRED");
}
export const loadQuoteAdmin = createServerFn({ method: "GET" })
  .middleware([tenantMiddleware])
  .handler(async ({ context }) => {
    admin(context);
    const db = context.supabase;
    const { data, error } = await db.rpc("wa_current_rate_rows", { p_tenant: context.tenantId });
    if (error) throw new Error("WA_SCHEMA_NOT_READY");
    if ((data ?? []).length > 500) throw new Error("WA_RATE_CARD_TOO_LARGE");
    return {
      rates: (data ?? []).map(rateFromRow),
      channelState: "OFF" as const,
      outboundState: "NOT_IMPLEMENTED" as const,
    };
  });
export const importQuoteCsv = createServerFn({ method: "POST" })
  .validator(z.object({ csv: z.string().min(1).max(200000) }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    admin(context);
    const rates = parseRateCsv(data.csv);
    const { createHash } = await import("node:crypto");
    const { data: id, error } = await context.supabase.rpc("wa_import_rates", {
      p_tenant: context.tenantId,
      p_sha256: createHash("sha256").update(data.csv).digest("hex"),
      p_rates: rates,
    });
    if (error) throw new Error("WA_IMPORT_REJECTED: " + error.message);
    return { batchId: id, count: rates.length };
  });
export const simulateQuote = createServerFn({ method: "POST" })
  .validator(z.object({ text: z.string().max(4096) }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    admin(context);
    const { data: rows, error } = await context.supabase.rpc("wa_current_rate_rows", {
      p_tenant: context.tenantId,
    });
    if (error) throw new Error("WA_SCHEMA_NOT_READY");
    if ((rows ?? []).length > 500) throw new Error("WA_RATE_CARD_TOO_LARGE");
    const result = simulate(data.text, (rows ?? []).map(rateFromRow), new Date().toISOString());
    return {
      ...result,
      draft: result.result
        ? draftQuote(result.result)
        : "DRAFT - NOT SENT. " + (result.parsed.ok ? "Review needed" : result.parsed.detail),
    };
  });

export const revokeQuoteBatch = createServerFn({ method: "POST" })
  .validator(z.object({ batchId: z.string().uuid(), reason: z.string().trim().min(10).max(2000) }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    admin(context);
    const { error } = await context.supabase.rpc("wa_revoke_rate_batch", {
      p_tenant: context.tenantId,
      p_batch: data.batchId,
      p_reason: data.reason,
    });
    if (error) throw new Error("WA_REVOCATION_REJECTED");
    return { revoked: true };
  });
