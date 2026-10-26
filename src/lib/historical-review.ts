import { z } from "zod";
/** A reviewed reference filter, never an assertion of imagery or terminal identity. */
export const historicalReviewInput = z.object({
  caseId: z.string().uuid(),
  requestId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  place: z.string().trim().min(1).max(160),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  confirmed: z.literal(true),
});
export const HISTORICAL_REVIEW_LIMITS =
  "Operator-reviewed reference place and South African date filter, not independent sensor evidence. Nearby recorded coordinates do not establish terminal or vessel identity, historical imagery coverage, exposure or causation. Record timestamps are as filed, not independently verified. No matching record does not prove no event occurred. Basemap pixels and live markers are not included.";
