import { describe, it, expect } from "vitest";
import { resolvePortCenter } from "./port-centers";
describe("case port query centers", () => {
  it("uses the case port, including aliases", () => {
    expect(resolvePortCenter("Durban")).toEqual(resolvePortCenter("ZADUR"));
    expect(resolvePortCenter(" ZA CPT ")).toEqual(resolvePortCenter("Cape Town"));
    expect(resolvePortCenter("ZACPT")).not.toEqual(resolvePortCenter("ZADUR"));
    expect(resolvePortCenter("ZARCB")).not.toEqual(resolvePortCenter("ZADUR"));
  });
  it("never silently sends unsupported/missing ports to Durban", () => {
    expect(() => resolvePortCenter(null)).toThrow("Unsupported or missing");
    expect(() => resolvePortCenter("ZZXXX")).toThrow("Unsupported or missing");
  });
});
