import { describe, expect, it } from "vitest";
import {
  assertSceneTransition,
  isViewable,
  requestConversion,
  validateTilesetUrl,
  compareSceneCaptures,
} from "./scene";

describe("requestConversion honesty", () => {
  it("reports converter_unavailable instead of faking a job", () => {
    const r = requestConversion("asset-1");
    expect(r.outcome).toBe("converter_unavailable");
    if (r.outcome === "converter_unavailable") expect(r.reason).toContain("No PLY/LAZ converter");
  });
});

describe("isViewable", () => {
  it("attempt viewer only for registered/ready candidate with URL", () => {
    expect(isViewable({ status: "ready", tilesetUrl: "https://x/tileset.json" })).toBe(true);
    expect(isViewable({ status: "ready", tilesetUrl: null })).toBe(false);
    expect(isViewable({ status: "converting", tilesetUrl: "https://x/tileset.json" })).toBe(false);
    expect(isViewable({ status: "registered" })).toBe(false);
    expect(
      isViewable({ status: "registered", tilesetUrl: "https://tiles.example/tileset.json" }),
    ).toBe(true);
  });
});

describe("validateTilesetUrl", () => {
  it("accepts a plain https tileset json", () => {
    expect(validateTilesetUrl("https://tiles.example.com/durban/tileset.json").ok).toBe(true);
  });
  it("rejects http, credentials, and non-json", () => {
    expect(validateTilesetUrl("http://tiles.example.com/tileset.json").ok).toBe(false);
    const cred = validateTilesetUrl("https://user:pass@tiles.example.com/tileset.json");
    expect(cred.ok).toBe(false);
    if (!cred.ok) expect(cred.reason).toContain("credentials");
    expect(validateTilesetUrl("https://tiles.example.com/durban/").ok).toBe(false);
    expect(validateTilesetUrl("not a url").ok).toBe(false);
  });
});

describe("scene status machine", () => {
  it("registered can go ready (direct tileset) or queued (conversion)", () => {
    expect(() => assertSceneTransition("registered", "ready")).not.toThrow();
    expect(() => assertSceneTransition("registered", "queued")).not.toThrow();
  });
  it("blocks converting -> registered and ready -> anything", () => {
    expect(() => assertSceneTransition("converting", "registered")).toThrow();
    expect(() => assertSceneTransition("ready", "queued")).toThrow();
  });
  it("failed can be re-queued once", () => {
    expect(() => assertSceneTransition("failed", "queued")).not.toThrow();
    expect(() => assertSceneTransition("failed", "ready")).toThrow();
  });
});

describe("tileset network boundaries", () => {
  it.each([
    "https://localhost/t.json",
    "https://127.0.0.1/t.json",
    "https://192.168.0.1/t.json",
    "https://[::1]/t.json",
  ])("refuses direct local/IP target %s", (url) => {
    expect(validateTilesetUrl(url).ok).toBe(false);
  });
});

describe("recorded capture comparison", () => {
  const a = { id: "a", name: "A", acquired_at: "2026-10-26T10:00:00Z" },
    b = { id: "b", name: "B", acquired_at: "2026-10-25T10:00:00Z" };
  it("orders by capture timestamp not upload/selection order", () => {
    const r = compareSceneCaptures(a, b);
    expect(r.ordered[0].id).toBe("b");
    expect(r.gapHours).toBe(24);
  });
  it("missing capture time cannot become verified before/after", () => {
    expect(compareSceneCaptures(a, { ...b, acquired_at: null }).gapHours).toBeNull();
  });
  it("same scene cannot be compared to itself", () => {
    expect(() => compareSceneCaptures(a, a)).toThrow("DISTINCT");
  });
});
