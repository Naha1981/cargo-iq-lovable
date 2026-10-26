/** Fail closed until a complete server-side schema/audit validator is deployed.
 * Table reads, browser state and an environment flag are deliberately insufficient.
 * No production or test activation is inferred from this source batch.
 */
export const INTEGRATED_FEATURE_UNAVAILABLE =
  "This workspace is not activated. Its complete database and audit safeguards have not been verified on this environment. No changes can be saved here. Existing case evidence and Harbour View remain available.";

export function requireIntegratedFeatureReady(): void {
  throw new Error(INTEGRATED_FEATURE_UNAVAILABLE);
}
