/** Server-authoritative readiness, never a browser flag or table-exists guess. */
export const INTEGRATED_FEATURE_UNAVAILABLE =
  "This workspace is not activated. Its complete database and audit safeguards have not been verified on this environment. No changes can be saved here. Existing case evidence and Harbour View remain available.";

interface ReadinessClient {
  rpc(name: "cargoiq_integrated_feature_readiness"): PromiseLike<{ data: unknown; error: unknown }>;
}
export async function integratedFeatureReady(client: ReadinessClient): Promise<boolean> {
  try {
    const { data, error } = await client.rpc("cargoiq_integrated_feature_readiness");
    return (
      !error &&
      typeof data === "object" &&
      data !== null &&
      (data as { ready?: unknown }).ready === true
    );
  } catch {
    return false;
  }
}
export async function requireIntegratedFeatureReady(client: ReadinessClient): Promise<void> {
  if (!(await integratedFeatureReady(client))) throw new Error(INTEGRATED_FEATURE_UNAVAILABLE);
}
