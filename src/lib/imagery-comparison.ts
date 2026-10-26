// Reuses case external_observations; no provider call, tile fetch or inferred imagery.
export interface RecordedImagery {
  id: string;
  source: string;
  observed_at: string;
  created_at: string;
  limitation: string | null;
  observation_type: string;
  payload: unknown;
}
export function recordedImagery(observations: RecordedImagery[]) {
  return observations
    .filter((o) => ["SENTINEL_1_SCENE", "SENTINEL_2_SCENE"].includes(o.observation_type))
    .map((o) => {
      const p =
        o.payload && typeof o.payload === "object" ? (o.payload as Record<string, unknown>) : {};
      const text = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
      const acquiredAt = text(p.acquiredAt);
      const valid = acquiredAt && Number.isFinite(Date.parse(acquiredAt)) ? acquiredAt : null;
      const bbox =
        Array.isArray(p.bbox) &&
        p.bbox.length === 4 &&
        p.bbox.every((n) => typeof n === "number" && Number.isFinite(n))
          ? (p.bbox as number[])
          : null;
      return {
        ...o,
        acquiredAt: valid,
        providerId: text(p.id),
        sourceUrl: text(p.sourceUrl),
        sensor: text(p.sensor) ?? o.observation_type,
        cloudPercent: typeof p.cloudPercent === "number" ? p.cloudPercent : null,
        bbox,
        licence: text(p.licence),
        resolutionM: typeof p.resolutionM === "number" ? p.resolutionM : null,
      };
    });
}
export function compareRecordedImagery(
  a: ReturnType<typeof recordedImagery>[number],
  b: ReturnType<typeof recordedImagery>[number],
) {
  if (a.id === b.id) throw new Error("DISTINCT_IMAGERY_REQUIRED");
  const gaps = [
    "Metadata coverage only. Pixel imagery has not been loaded or inspected. No change or cause is established.",
  ];
  if (!a.acquiredAt || !b.acquiredAt)
    gaps.push("Acquisition time missing: before/after order unverified.");
  if (!a.bbox || !b.bbox) gaps.push("Coverage geometry missing: common footprint unverified.");
  else if (
    a.bbox[0] > b.bbox[2] ||
    b.bbox[0] > a.bbox[2] ||
    a.bbox[1] > b.bbox[3] ||
    b.bbox[1] > a.bbox[3]
  )
    gaps.push("Recorded footprints do not overlap; not a same-area comparison.");
  if (a.sensor !== b.sensor)
    gaps.push("Different sensors: direct visual/radiometric comparability unverified.");
  if (!a.licence || !b.licence)
    gaps.push("Licence terms not recorded. Do not assume rights for imagery retrieval or export.");
  return {
    ordered:
      a.acquiredAt && b.acquiredAt && Date.parse(a.acquiredAt) > Date.parse(b.acquiredAt)
        ? [b, a]
        : [a, b],
    gaps,
  };
}
