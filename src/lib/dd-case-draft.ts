import { z } from "zod";
const text = z.string().max(2000);
export const ddCaseDraftSchema = z.object({
  containerNo: text,
  discharge: text,
  gateOut: text,
  invoiceNo: text,
  amount: text,
  delayDays: text,
  ev: z.object({ description: text, source: text, capturedAt: text, from: text, to: text }),
  ledger: z
    .array(
      z.object({
        id: z.string().max(40),
        kind: z.literal("other"),
        description: text,
        source: text,
        capturedAt: text.nullable(),
        suppliedBy: z.literal("user"),
        coversFrom: text,
        coversTo: text,
        cause: z.literal("terminal"),
        status: z.enum(["INFERRED", "VERIFIED"]),
      }),
    )
    .max(100),
});
export type DdCaseDraft = z.infer<typeof ddCaseDraftSchema>;
export const emptyDdCaseDraft = (): DdCaseDraft => ({
  containerNo: "",
  discharge: "",
  gateOut: "",
  invoiceNo: "",
  amount: "",
  delayDays: "",
  ev: { description: "", source: "", capturedAt: "", from: "", to: "" },
  ledger: [],
});
