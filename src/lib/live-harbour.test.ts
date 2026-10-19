import { describe, expect, it } from "vitest";
import { liveHarbourHref } from "./live-harbour";

describe("liveHarbourHref", () => {
  it("deep-links Durban cases to the Durban fly-to", () => {
    expect(liveHarbourHref("ZADUR")).toBe("/harbour-view/index.html?fly=durban");
    expect(liveHarbourHref("zadur")).toBe("/harbour-view/index.html?fly=durban");
  });

  it("deep-links Richards Bay cases", () => {
    expect(liveHarbourHref("ZARCB")).toBe("/harbour-view/index.html?fly=richards");
  });

  it("falls back to the plain live view for other or missing ports", () => {
    expect(liveHarbourHref("ZACPT")).toBe("/harbour-view/index.html");
    expect(liveHarbourHref(null)).toBe("/harbour-view/index.html");
    expect(liveHarbourHref(undefined)).toBe("/harbour-view/index.html");
  });
});
