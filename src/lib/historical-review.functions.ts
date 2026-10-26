import { createServerFn } from "@tanstack/react-start";
import { requireIntegratedFeatureReady } from "@/lib/integrated-feature-gate";
import { tenantMiddleware } from "@/lib/auth-middleware";
import { historicalReviewInput } from "@/lib/historical-review";

export const saveHistoricalReview = createServerFn({ method: "POST" })
  .validator(historicalReviewInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    await requireIntegratedFeatureReady(context.supabase);
    const readiness = await context.supabase.rpc("cargoiq_historical_review_readiness");
    if (
      readiness.error ||
      (readiness.data as unknown as { ready?: boolean } | null)?.ready !== true
    )
      throw new Error(
        "Historical case contributions are not activated on this environment. Nothing saved.",
      );
    // The proposed RPC derives the source records and writes review + audit in one
    // transaction. There is deliberately no browser-provided record ID/payload list.
    const { data: result, error } = await context.supabase.rpc("save_historical_record_review", {
      p_case_id: data.caseId,
      p_request_id: data.requestId,
      p_date: data.date,
      p_place: data.place,
      p_lat: data.lat,
      p_lon: data.lon,
      p_confirmed: data.confirmed,
    });
    if (error) throw new Error("Historical review was not confirmed saved: " + error.message);
    return result as unknown as { observationId: string; recordCount: number };
  });
