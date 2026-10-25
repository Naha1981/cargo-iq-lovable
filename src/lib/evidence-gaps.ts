import { z } from "zod";
export const gapStates = ["EXPECTED", "RECEIVED", "CONFLICTING", "MISSING"] as const;
export const gapInput = z
  .object({
    caseId: z.string().uuid(),
    physicalReference: z.string().trim().min(3).max(200),
    requiredEvent: z.string().trim().min(3).max(200),
    requirementBasis: z.string().trim().min(10).max(4000),
    status: z.enum(gapStates),
    explanation: z.string().trim().min(10).max(4000),
    documentIds: z.array(z.string().uuid()).max(20),
    evidenceReference: z.string().trim().min(3).max(2000),
    supersedesId: z.string().uuid().nullable(),
  })
  .superRefine((x, c) => {
    if (x.status === "RECEIVED" && x.documentIds.length < 1)
      c.addIssue({
        code: "custom",
        path: ["documentIds"],
        message: "Received requires a case source document",
      });
    if (x.status === "CONFLICTING" && x.documentIds.length < 2)
      c.addIssue({
        code: "custom",
        path: ["documentIds"],
        message: "Conflicting requires at least two source documents and an explanation",
      });
    if (new Set(x.documentIds).size !== x.documentIds.length)
      c.addIssue({ code: "custom", path: ["documentIds"], message: "Duplicate evidence document" });
  });
export function latestGaps(rows: any[]) {
  const m = new Map<string, any>();
  for (const r of rows) {
    const k = JSON.stringify([r.physical_reference, r.required_event]);
    if (!m.has(k) || m.get(k).version < r.version) m.set(k, r);
  }
  return [...m.values()];
}
