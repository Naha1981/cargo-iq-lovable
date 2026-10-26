import { describe, expect, it } from "vitest";
import { imagerySearchInput, pointInFootprint, parseOpenImagery } from "./open-imagery";
const ring = [
  [30, -31],
  [32, -31],
  [32, -29],
  [30, -29],
  [30, -31],
];
const item = {
  id: "scene",
  geometry: { type: "Polygon", coordinates: [ring] },
  properties: { datetime: "2026-09-09T08:08:26.119Z", "proj:epsg": 32736, "eo:cloud_cover": 20 },
  assets: {
    thumbnail: {
      href: "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/test/preview.jpg",
    },
    visual: {
      "proj:transform": [10, 0, 300000, 0, -10, 6700000],
      "proj:shape": [10980, 10980],
      gsd: 10,
    },
  },
  links: [
    {
      rel: "self",
      href: "https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/scene",
    },
  ],
};
describe("public imagery source boundary", () => {
  it("checks polygon rather than bounding box", () => {
    expect(pointInFootprint(31, -30, ring)).toBe(true);
    expect(pointInFootprint(33, -30, ring)).toBe(false);
  });
  it("retains actual source and acquisition provenance", () =>
    expect(parseOpenImagery(item, 31, -30)).toMatchObject({
      acquiredAt: item.properties.datetime,
      cloudPercent: 20,
      nativeResolutionM: 10,
    }));
  it("refuses outside footprint", () => expect(parseOpenImagery(item, 33, -30)).toBeNull());
  it("refuses arbitrary external preview hosts", () =>
    expect(
      parseOpenImagery(
        {
          ...item,
          assets: { ...item.assets, thumbnail: { href: "https://evil.invalid/preview.jpg" } },
        },
        31,
        -30,
      ),
    ).toBeNull());
  it("refuses malformed and nonpolygon source", () =>
    expect(parseOpenImagery({}, 31, -30)).toBeNull());
  it("bounds coordinate input", () =>
    expect(
      imagerySearchInput.safeParse({
        caseId: "00000000-0000-4000-8000-000000000001",
        longitude: 181,
        latitude: -30,
        date: "2026-09-09",
      }).success,
    ).toBe(false));
});
