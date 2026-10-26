import { z } from "zod";

export const imagerySearchInput = z.object({
  caseId: z.string().uuid(),
  longitude: z.number().min(-180).max(180),
  latitude: z.number().min(-80).max(84),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export interface OpenImageryScene {
  id: string;
  acquiredAt: string;
  cloudPercent: number | null;
  previewUrl: string;
  sourceUrl: string;
  footprint: number[][];
  crs: number;
  transform: number[];
  shape: number[];
  nativeResolutionM: number;
}
export function pointInFootprint(lon: number, lat: number, ring: number[][]): boolean {
  if (ring.length < 4) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i],
      [px, py] = ring[j];
    if (y > lat !== py > lat && lon < ((px - x) * (lat - y)) / (py - y) + x) inside = !inside;
  }
  return inside;
}
const position = z.tuple([z.number().finite(), z.number().finite()]);
const itemSchema = z.object({
  id: z.string().max(200),
  geometry: z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(position)) }),
  properties: z.object({
    datetime: z.string().datetime(),
    "eo:cloud_cover": z.number().optional(),
    "proj:epsg": z.number(),
  }),
  assets: z.object({
    thumbnail: z.object({ href: z.string().url() }),
    visual: z.object({
      "proj:transform": z.array(z.number()),
      "proj:shape": z.array(z.number()),
      gsd: z.number(),
    }),
  }),
  links: z.array(z.object({ rel: z.string(), href: z.string().url() })),
});
export function parseOpenImagery(
  item: unknown,
  longitude: number,
  latitude: number,
): OpenImageryScene | null {
  const parsed = itemSchema.safeParse(item);
  if (!parsed.success) return null;
  const p = parsed.data;
  const url = new URL(p.assets.thumbnail.href);
  const source = p.links.find((l) => l.rel === "self")?.href;
  if (
    url.protocol !== "https:" ||
    url.hostname !== "sentinel-cogs.s3.us-west-2.amazonaws.com" ||
    !url.pathname.endsWith("/preview.jpg") ||
    !source ||
    new URL(source).origin !== "https://earth-search.aws.element84.com" ||
    !pointInFootprint(longitude, latitude, p.geometry.coordinates[0])
  )
    return null;
  return {
    id: p.id,
    acquiredAt: p.properties.datetime,
    cloudPercent: p.properties["eo:cloud_cover"] ?? null,
    previewUrl: url.href,
    sourceUrl: source,
    footprint: p.geometry.coordinates[0],
    crs: p.properties["proj:epsg"],
    transform: p.assets.visual["proj:transform"],
    shape: p.assets.visual["proj:shape"],
    nativeResolutionM: p.assets.visual.gsd,
  };
}

export function formatImageryDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Choose a complete date";
  const parsed = new Date(date + "T00:00:00Z");
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
    return "Invalid date";
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}
