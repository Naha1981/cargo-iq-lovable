import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const context = {};
runInNewContext(readFileSync("public/voice/voice-controls.js", "utf8"), context);
const intent = (
  context as { NahaVoiceIntent: (text: string, product: string) => { kind: string; path?: string } }
).NahaVoiceIntent;
describe("safe voice commands", () => {
  it("allows case views but not mutations", () => {
    expect(intent("show documents", "cargo").path).toBe("documents");
    for (const text of ["send evidence pack", "delete case", "upload document", "seal pack"])
      expect(intent(text, "cargo").kind).toBe("miss");
  });
  it("allows rail read views only", () => {
    expect(intent("incident history", "rail").kind).toBe("history");
    expect(intent("show cameras", "rail").kind).toBe("cameras");
    expect(intent("dispatch train", "rail").kind).toBe("miss");
  });
  it("has explicit stop, help and evidence gap intent", () => {
    expect(intent("stop", "cargo").kind).toBe("stop");
    expect(intent("help", "rail").kind).toBe("help");
    expect(intent("missing evidence", "cargo").kind).toBe("gaps");
  });
});
