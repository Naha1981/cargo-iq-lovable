import { it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const js = readFileSync("public/harbour-view/assets/app.js", "utf8");
function command(raw: string, hit: unknown = { mmsi: "636026662" }) {
  const say = vi.fn(),
    fly = vi.fn(),
    show = vi.fn(),
    post = vi.fn();
  const script = js.slice(
    js.indexOf("  function handleVoiceCommand(raw)"),
    js.indexOf("  var SR ="),
  );
  vm.runInNewContext(script + "\nhandleVoiceCommand(raw)", {
    raw,
    reviewHistory: () => false,
    historicalReviewActive: false,
    cargoHeard: () => {},
    normVoice: (x: string) => x,
    findVesselFuzzy: () => hit,
    vessels: new Map([["636026662", { rec: { name: "MOL EXPERIENCE", lon: 31.04, lat: -29.87 } }]]),
    showVessel: show,
    flyToPoint: fly,
    cargoSay: say,
    EMBED: true,
    window: { location: { origin: "https://example.test" }, parent: { postMessage: post } },
  });
  return { say, fly, show, post };
}
it("MOL EXPERIENCE entity resolves before fuzzy weather aliases", () => {
  const r = command("find MOL EXPERIENCE");
  expect(r.show).toHaveBeenCalledWith("636026662");
  expect(r.fly).toHaveBeenCalledWith(31.04, -29.87, 5000);
});
it("unknown numbered terminal never invents coordinates", () => {
  const r = command("take me to Durban port terminal 5");
  expect(r.fly).not.toHaveBeenCalled();
  expect(r.say.mock.calls[0][0]).toContain("not in the verified terminal registry");
});
it("case shipment delegates to authenticated case records", () => {
  const r = command("show my shipment");
  expect(r.post).toHaveBeenCalledWith({ type: "cargo-shipment-request" }, "https://example.test");
});
it("same-origin microphone and frame policy match static and server", () => {
  const headers = readFileSync("public/_headers", "utf8"),
    server = readFileSync("src/server.ts", "utf8");
  for (const s of [headers, server]) {
    expect(s).toContain("microphone=(self)");
    expect(s).toContain("frame-ancestors 'self'");
  }
});
