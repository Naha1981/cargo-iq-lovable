export interface SatelliteScene {
  id: string;
  sensor: "SENTINEL-1" | "SENTINEL-2";
  acquiredAt: string | null;
  cloudPercent: number | null;
  bbox: [number, number, number, number] | null;
  geometry: unknown;
  relativeOrbit: number | null;
  orbitDirection: string | null;
  assets: Record<string, string>;
  sourceUrl: string;
}
const STAC = "https://stac.dataspace.copernicus.eu/v1/search";

interface StacAsset {
  href?: unknown;
}

interface StacFeature {
  id?: unknown;
  collection?: string;
  properties?: Record<string, unknown>;
  assets?: Record<string, StacAsset>;
  bbox?: unknown;
  geometry?: unknown;
}
export async function querySentinelScenes(options: {
  bbox: [number, number, number, number];
  start: string;
  end: string;
  limit?: number;
}) {
  const [west, south, east, north] = options.bbox;
  const response = await fetch(STAC, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      collections: ["sentinel-1-grd", "sentinel-2-l2a"],
      bbox: [west, south, east, north],
      datetime: new Date(options.start).toISOString() + "/" + new Date(options.end).toISOString(),
      limit: options.limit ?? 20,
      sortby: [{ field: "datetime", direction: "asc" }],
    }),
  });
  if (!response.ok) throw new Error("COPERNICUS_STAC_" + response.status);
  const json = (await response.json()) as { features?: StacFeature[] };
  return (json.features ?? []).map((item): SatelliteScene => {
    const sensor = String(item.collection ?? "").includes("sentinel-1")
      ? "SENTINEL-1"
      : "SENTINEL-2";
    const props = item.properties ?? {};
    const assets: Record<string, string> = {};
    for (const [key, asset] of Object.entries(item.assets ?? {}))
      if (asset?.href) assets[key] = String(asset.href);
    return {
      id: String(item.id),
      sensor,
      acquiredAt: props.datetime ? new Date(String(props.datetime)).toISOString() : null,
      cloudPercent: props["eo:cloud_cover"] != null ? Number(props["eo:cloud_cover"]) : null,
      bbox:
        Array.isArray(item.bbox) && item.bbox.length === 4
          ? (item.bbox as [number, number, number, number])
          : null,
      geometry: item.geometry ?? null,
      relativeOrbit:
        props["sat:relative_orbit"] != null ? Number(props["sat:relative_orbit"]) : null,
      orbitDirection: props["sat:orbit_state"] ? String(props["sat:orbit_state"]) : null,
      assets,
      sourceUrl: "https://dataspace.copernicus.eu/",
    };
  });
}
