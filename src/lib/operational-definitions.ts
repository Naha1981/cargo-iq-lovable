import { z } from "zod";
export const definitionInput = z
  .object({
    caseId: z.string().uuid(),
    party: z.string().trim().min(2).max(200),
    metric: z.enum(["HATCH_COVER", "TRUCK_VISIT", "CONTAINER_DELIVERY", "GATE_COUNT", "OTHER"]),
    unit: z.string().trim().min(1).max(100),
    rule: z.string().trim().min(10).max(4000),
    originalSourceText: z.string().trim().min(10).max(8000),
    sourceDocumentId: z.string().uuid(),
    sourceReference: z.string().trim().min(3).max(1000),
    effectiveFrom: z.string().datetime({ offset: true }),
    effectiveTo: z.string().datetime({ offset: true }).nullable(),
    acceptance: z.enum(["CONTRACTUALLY_SPECIFIED", "AGREED", "PARTY_REPORTED", "UNRESOLVED"]),
    acceptanceBasis: z.string().trim().min(10).max(2000),
    supersedesId: z.string().uuid().nullable(),
  })
  .refine((x) => !x.effectiveTo || Date.parse(x.effectiveTo) > Date.parse(x.effectiveFrom), {
    message: "Effective end must be after start",
    path: ["effectiveTo"],
  });
export function latestDefinitions<T extends { party: string; metric: string; version: number }>(
  rows: T[],
) {
  const latest = new Map<string, T>();
  for (const row of rows) {
    const key = JSON.stringify([row.party.trim().toLowerCase(), row.metric]);
    const cur = latest.get(key);
    if (!cur || row.version > cur.version) latest.set(key, row);
  }
  return [...latest.values()];
}
