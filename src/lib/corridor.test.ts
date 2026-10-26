import { describe, expect, it } from "vitest";
import {
  formatAge,
  freshness,
  graticulePaths,
  metersPerPixel,
  niceScaleWidth,
  positionBanner,
  positionClaim,
  riskEventToPoint,
  timelineEventToPoint,
  recordedAisToPoint,
  candidateAisRecords,
  type CorridorPoint,
} from "./corridor";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const pos = (over: Partial<CorridorPoint>): CorridorPoint => ({
  id: "p1",
  kind: "shipment_position",
  latitude: -29.8,
  longitude: 31.0,
  observedAt: null,
  source: null,
  state: "unknown",
  label: "t",
  ...over,
});

describe("freshness", () => {
  it("fresh within 6h, stale beyond, unknown without timestamp", () => {
    expect(freshness(NOW, "2026-10-26T08:00:00Z")).toBe("fresh");
    expect(freshness(NOW, "2026-10-26T05:59:59Z")).toBe("stale");
    expect(freshness(NOW, null)).toBe("unknown");
    expect(freshness(NOW, "not-a-date")).toBe("unknown");
  });
});

describe("positionClaim honesty", () => {
  it("current only when observed AND fresh", () => {
    expect(
      positionClaim([pos({ state: "observed", observedAt: "2026-10-26T09:00:00Z" })], NOW),
    ).toBe("observed_fresh");
  });
  it("never current for derived/inferred even if fresh", () => {
    expect(
      positionClaim([pos({ state: "derived", observedAt: "2026-10-26T11:59:00Z" })], NOW),
    ).toBe("last_known");
    expect(
      positionClaim([pos({ state: "inferred", observedAt: "2026-10-26T11:59:00Z" })], NOW),
    ).toBe("last_known");
  });
  it("never current for stale observed", () => {
    expect(
      positionClaim([pos({ state: "observed", observedAt: "2026-10-20T09:00:00Z" })], NOW),
    ).toBe("last_known");
  });
  it("never uses the word current in any banner", () => {
    const banners = [
      positionBanner([pos({ state: "observed", observedAt: "2026-10-26T09:00:00Z" })], NOW),
      positionBanner([pos({ state: "derived", observedAt: "2026-10-26T11:00:00Z" })], NOW),
      positionBanner([], NOW),
    ];
    for (const b of banners) expect(b.toLowerCase()).not.toContain("current");
  });
  it("observed_fresh banner carries timestamp and age, no live claim", () => {
    const b = positionBanner([pos({ state: "observed", observedAt: "2026-10-26T09:00:00Z" })], NOW);
    expect(b).toContain("26/10/2026");
    expect(b).toContain("3 h old");
    expect(b).toContain("not a live feed");
  });
  it("no_position when nothing recorded", () => {
    expect(positionClaim([], NOW)).toBe("no_position");
    expect(positionBanner([], NOW)).toContain("No recorded position");
  });
  it("picks the newest position", () => {
    expect(
      positionClaim(
        [
          pos({ id: "old", state: "observed", observedAt: "2026-10-25T00:00:00Z" }),
          pos({ id: "new", state: "observed", observedAt: "2026-10-26T10:00:00Z" }),
        ],
        NOW,
      ),
    ).toBe("observed_fresh");
  });
});

describe("map context helpers", () => {
  it("formatAge picks sensible units", () => {
    expect(formatAge(NOW, "2026-10-26T11:30:00Z")).toBe("30 min old");
    expect(formatAge(NOW, "2026-10-26T08:00:00Z")).toBe("4 h old");
    expect(formatAge(NOW, "2026-10-20T12:00:00Z")).toBe("6 d old");
  });
  it("graticule covers southern Africa at 1-degree spacing", () => {
    const g = graticulePaths();
    expect(g.length).toBe(18 + 15); // 18 meridians + 15 parallels
    expect(g[0][0]).toEqual([16, -35]);
  });
  it("scale width rounds to a nice labelled distance", () => {
    const mpp = metersPerPixel(-29, 5);
    const s = niceScaleWidth(mpp);
    expect(s.meters / mpp).toBeGreaterThan(0);
    expect(s.label).toMatch(/(km|m)$/);
  });
});

describe("riskEventToPoint", () => {
  const base = {
    id: "e1",
    latitude: -29.87,
    longitude: 31.04,
    observed_at: "2026-10-26T06:00:00Z",
    source: "port-feed",
    verification_status: "confirmed",
    title: "Congestion",
  };
  it("maps confirmed to observed, suspected to inferred", () => {
    expect(riskEventToPoint(base)?.state).toBe("observed");
    expect(riskEventToPoint({ ...base, verification_status: "suspected" })?.state).toBe("inferred");
    expect(riskEventToPoint({ ...base, verification_status: "whatever" })?.state).toBe("unknown");
  });
  it("drops events without coordinates instead of guessing a location", () => {
    expect(riskEventToPoint({ ...base, latitude: null })).toBeNull();
  });
});

describe("invalid source observations", () => {
  it("future timestamps are unknown, never fresh", () => {
    expect(freshness(NOW, "2026-10-27T00:00:00Z")).toBe("unknown");
    expect(formatAge(NOW, "2026-10-27T00:00:00Z")).toContain("future timestamp");
  });
  it("drops invalid geographic coordinates", () => {
    const e = {
      id: "e",
      latitude: 91,
      longitude: 31,
      observed_at: "2026-10-26T00:00:00Z",
      source: "fixture",
      verification_status: "confirmed",
      title: "fixture",
    };
    expect(riskEventToPoint(e)).toBeNull();
    expect(riskEventToPoint({ ...e, latitude: 0, longitude: NaN })).toBeNull();
  });
});

describe("recorded timeline map adapter", () => {
  const e = {
    id: "t1",
    title: "Gate entry",
    timestamp: "2026-10-26T10:00:00Z",
    source: "Gate document",
    nature: "reported",
    coordinates: { lat: -29.8, lon: 31.0 },
    provenance_id: "doc",
  };
  it("preserves timestamp, source and provenance without upgrading reported to observed", () => {
    const p = timelineEventToPoint(e);
    expect(p?.state).toBe("unknown");
    expect(p?.observedAt).toBe(e.timestamp);
    expect(p?.provenanceId).toBe("doc");
    expect(p?.recordKind).toBe("timeline_event");
  });
  it("does not guess coordinates or turn generic events into shipment fixes", () => {
    expect(timelineEventToPoint({ ...e, coordinates: null })).toBeNull();
    expect(timelineEventToPoint(e)).not.toHaveProperty("kind", "shipment_position");
  });
});

describe("archived AIS identity boundary", () => {
  const o = {
    id: "obs",
    observation_type: "AIS_POSITION",
    latitude: -29.8,
    longitude: 31.0,
    observed_at: "2026-10-26T10:00:00Z",
    source: "AIS record",
    payload: { vesselName: "MV TEST", mmsi: "123456789" },
  };
  it("preserves archived coordinates and timing without claiming verified/live position", () => {
    const p = recordedAisToPoint(o, "MV Test");
    expect(p?.state).toBe("unknown");
    expect(p?.observedAt).toBe(o.observed_at);
    expect(p?.recordKind).toBe("ais_position");
  });
  it("refuses other/missing vessel identity even when row is case-associated", () => {
    expect(recordedAisToPoint(o, "MV OTHER")).toBeNull();
    expect(recordedAisToPoint({ ...o, payload: {} }, "MV TEST")).toBeNull();
    expect(recordedAisToPoint(o, null)).toBeNull();
  });
  it("does not promote generic weather/event observations or invalid coordinates", () => {
    expect(recordedAisToPoint({ ...o, observation_type: "MARINE_WEATHER" }, "MV TEST")).toBeNull();
    expect(recordedAisToPoint({ ...o, latitude: 91 }, "MV TEST")).toBeNull();
  });
});

it("withholds same-name different-MMSI collisions instead of choosing a shipment position", () => {
  const o = {
    id: "a",
    observation_type: "AIS_POSITION",
    latitude: -29,
    longitude: 31,
    observed_at: "2026-10-26T10:00:00Z",
    source: "fixture",
    payload: { vesselName: "MV TEST", mmsi: "111111111" },
  };
  const r = candidateAisRecords(
    [o, { ...o, id: "b", payload: { vesselName: "MV TEST", mmsi: "222222222" } }],
    "MV TEST",
  );
  expect(r.points).toEqual([]);
  expect(r.warning).toContain("multiple MMSIs");
});
