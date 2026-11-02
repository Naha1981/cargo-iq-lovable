import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { tenantMiddleware } from "@/lib/auth-middleware";
import { ddCaseDraftSchema } from "@/lib/dd-case-draft";
const caseInput = z.object({ caseId: z.string().uuid() });
export const loadDdCaseDraft = createServerFn({ method: "GET" })
  .validator(caseInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("cargoiq_load_dd_draft", {
      p_case_id: data.caseId,
    });
    if (error) throw error;
    const row = z
      .object({ revision: z.number().int().nonnegative(), draft: ddCaseDraftSchema.nullable() })
      .parse(result);
    return row;
  });
export const saveDdCaseDraft = createServerFn({ method: "POST" })
  .validator(
    caseInput.extend({ revision: z.number().int().nonnegative(), draft: ddCaseDraftSchema }),
  )
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const { data: result, error } = await context.supabase.rpc("cargoiq_save_dd_draft", {
      p_case_id: data.caseId,
      p_revision: data.revision,
      p_draft: data.draft,
    });
    if (error) throw error;
    return z.object({ revision: z.number().int().positive() }).parse(result);
  });
