import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const html = readFileSync("public/harbour-view/index.html", "utf8");
const script = readFileSync("public/harbour-view/assets/camera-viewer.js", "utf8");
const get = (id: string) => document.getElementById(id)!;
const api = () =>
  (window as unknown as { CargoCameraViewer: { open: (id?: string) => void; close: () => void } })
    .CargoCameraViewer;
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = html.slice(
    html.indexOf('<button id="cam-open"'),
    html.indexOf('<button id="cond-btn"'),
  );
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  window.eval(script);
});
afterEach(() => {
  api().close();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("harbour camera viewer", () => {
  it("has an obvious keyboard reachable entry and camera choice", () => {
    get("cam-open").click();
    expect(get("cam-panel").classList.contains("hidden")).toBe(false);
    expect(get("cam-live").getAttribute("src")).toContain("c1b53a50");
    expect(document.activeElement).toBe(get("cam-close"));
    expect(get("cam-open").getAttribute("aria-expanded")).toBe("true");
  });
  it("does not claim cross-origin video is playing just because the iframe loaded", () => {
    api().open("vetchs");
    get("cam-live").dispatchEvent(new Event("load"));
    expect(get("cam-status").textContent).toContain("Playback cannot be confirmed");
  });
  it("offers a bounded slow-load recovery without auto-switching source", () => {
    api().open("bluewaters");
    vi.advanceTimersByTime(15001);
    expect(get("cam-status").textContent).toContain("taking too long");
    expect(get("cam-live").getAttribute("src")).toContain("7bd8fb34");
  });
  it("reloads the selected camera and keeps its source label", () => {
    api().open("bluewaters");
    get("cam-retry").click();
    expect(get("cam-live").getAttribute("src")).toContain("7bd8fb34");
    expect(get("cam-source").textContent).toContain("Beach");
  });
  it("keeps recorded fallback explicit, labelled and out of case evidence", () => {
    api().open("vetchs");
    get("cam-fallback").click();
    expect(get("cam-reference").getAttribute("src")).toMatch(/\.mp4$/);
    expect(get("cam-source").textContent).toContain("Not live, not Durban, not this case");
    expect(get("cam-live").hasAttribute("src")).toBe(false);
    expect(document.querySelector(".camera-notice")?.textContent?.replace(/\s+/g, " ")).toContain(
      "no footage is saved",
    );
  });
  it("shows reference-ready, actual playing and media failure states", () => {
    api().open("reference");
    get("cam-reference").dispatchEvent(new Event("loadeddata"));
    expect(get("cam-status").textContent).toContain("ready");
    get("cam-reference").dispatchEvent(new Event("playing"));
    expect(get("cam-status").textContent).toContain("Playing recorded reference");
    get("cam-reference").dispatchEvent(new Event("error"));
    expect(get("cam-status").textContent).toContain("could not load");
  });
  it("close removes both sources, pauses video and cancels late load effects", () => {
    api().open("reference");
    get("cam-close").click();
    expect(get("cam-reference").hasAttribute("src")).toBe(false);
    expect(get("cam-live").hasAttribute("src")).toBe(false);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    vi.advanceTimersByTime(16000);
    expect(get("cam-status").textContent).toBe("");
  });
  it("Escape closes and returns focus", () => {
    get("cam-open").focus();
    get("cam-open").click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(get("cam-panel").classList.contains("hidden")).toBe(true);
    expect(document.activeElement).toBe(get("cam-open"));
  });
  it("an unknown camera id fails safely to a configured public provider", () => {
    api().open("https://attacker.invalid");
    expect(get("cam-live").getAttribute("src")).toContain("restreamer.cd.net.za/c1b53a50");
  });
  it("CSP permits only the selected media host while keeping frame restrictions", () => {
    const headers = readFileSync("public/_headers", "utf8");
    expect(headers).toContain("media-src 'self' https://www.openbeelden.nl");
    expect(headers).toContain("frame-src https://restreamer.cd.net.za;");
    expect(html).toContain("media-src 'self' https://www.openbeelden.nl");
    expect(readFileSync("src/server.ts", "utf8")).toContain(
      "media-src 'self' https://www.openbeelden.nl",
    );
  });
});
