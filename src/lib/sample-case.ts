/** Identify only the exact known seeded fixture, never arbitrary customer cases. */
export function isSeededSampleCase(c: {
  reference_no: string;
  vessel_name?: string | null;
  container_no?: string | null;
}) {
  return (
    c.reference_no === "DUR-2026-0412" &&
    c.vessel_name === "MV Umhlanga Trader" &&
    c.container_no === "MSKU7748213"
  );
}
