import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const code = readFileSync("public/harbour-view/assets/history-command.js", "utf8");
const root = {} as {
  CargoHistoryCommand: {
    parse: (s: string) => { historical: boolean; date: string | null };
    day: (s: string) => string | null;
    formatDate: (s: string) => string;
    recordsFor: (r: unknown[], d: string, p: unknown) => unknown[];
  };
};
new Function("window", code)(root);
const h = root.CargoHistoryCommand;
describe("existing Harbour historical command repair", () => {
  it("preserves explicit ordinal date, requires review before action", () =>
    expect(h.parse("take me to terminal point on the 3rd of December 2025").date).toBe(
      "2025-12-03",
    ));
  it.each(["on 03/04/2025", "yesterday", "on 31 February 2025", "on Monday", "December"])(
    "does not guess %s",
    (s) => expect(h.parse(s)).toEqual({ historical: true, date: null }),
  );
  it("shows an unambiguous spoken-month date", () =>
    expect(h.formatDate("2025-12-03")).toBe("3 December 2025"));
  it("leaves plain live commands alone", () =>
    expect(h.parse("show Durban").historical).toBe(false));
  it("uses SAST recorded day, never upload time", () =>
    expect(h.day("2025-12-02T23:00:00Z")).toBe("2025-12-03"));
  it("returns only finite nearby timestamped records", () => {
    const r = { timestamp: "2025-12-03T10:00:00Z", lat: -29.856, lon: 31.041 };
    expect(
      h.recordsFor(
        [r, { ...r, timestamp: "2026-01-01" }, { ...r, lat: 0 }, { ...r, lat: NaN }],
        "2025-12-03",
        r,
      ),
    ).toEqual([r]);
  });
});
