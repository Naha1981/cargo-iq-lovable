/** No monetary recovery claim is valid while conflicting evidence remains flagged. */
export function caseRecovery(
  charged: number,
  calculated: number,
  openContradictions: number,
): number | null {
  return openContradictions > 0 ? null : Math.max(0, charged - calculated);
}
