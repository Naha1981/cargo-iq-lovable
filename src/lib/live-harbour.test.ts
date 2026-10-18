import { describe, expect, it } from "vitest";
import { liveHarbourHref } from "./live-harbour";

describe("liveHarbourHref", () => {
  it("deep-links Durban cases to the Durban fly-to", () => {
    expect(liveHarbourHref("ZADUR")).toBe("https://nahalabs.co.za/harbour-view?fly=durban");
    expect(liveHarbourHref("zadur")).toBe("https://nahalabs.co.za/harbour-view?fly=durban");
  });

  it("deep-links Richards Bay cases", () => {
    expect(liveHarbourHref("ZARCB")).toBe("https://nahalabs.co.za/harbour-view?fly=richards");
  });

  it("falls back to the plain live view for other or missing ports", () => {
    expect(liveHarbourHref("ZACPT")).toBe("https://nahalabs.co.za/harbour-view");
    expect(liveHarbourHref(null)).toBe("https://nahalabs.co.za/harbour-view");
    expect(liveHarbourHref(undefined)).toBe("https://nahalabs.co.za/harbour-view");
  });
});
