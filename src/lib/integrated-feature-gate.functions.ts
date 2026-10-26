import { createServerFn } from "@tanstack/react-start";
import { tenantMiddleware } from "@/lib/auth-middleware";
import { integratedFeatureReady } from "@/lib/integrated-feature-gate";
export const getIntegratedFeatureReadiness = createServerFn({ method: "GET" })
  .middleware([tenantMiddleware])
  .handler(async ({ context }) => ({ ready: await integratedFeatureReady(context.supabase) }));
