import { afterEach, describe, expect, it } from "vitest";
import { resolveClaimAiProvider } from "@/lib/extraction.functions";

const keys = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CLAIM_AI_PROVIDER", "LOVABLE_API_KEY"];
const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
afterEach(() => { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
const clear = () => { for (const k of keys) delete process.env[k]; };

describe("claim AI provider selection", () => {
  it("falls back to the gateway when no own key is set", () => {
    clear(); process.env["LOVABLE_API_KEY"] = "x";
    expect(resolveClaimAiProvider().kind).toBe("gateway");
  });
  it("reports none when nothing is configured", () => {
    clear();
    expect(resolveClaimAiProvider().kind).toBe("none");
  });
  it("prefers an own key over the gateway", () => {
    clear(); process.env["LOVABLE_API_KEY"] = "x"; process.env["ANTHROPIC_API_KEY"] = "a";
    expect(resolveClaimAiProvider().kind).toBe("anthropic");
    process.env["OPENAI_API_KEY"] = "o";
    expect(resolveClaimAiProvider().kind).toBe("openai");
  });
  it("honours CLAIM_AI_PROVIDER when that key exists", () => {
    clear(); process.env["OPENAI_API_KEY"] = "o"; process.env["ANTHROPIC_API_KEY"] = "a"; process.env["CLAIM_AI_PROVIDER"] = "anthropic";
    expect(resolveClaimAiProvider().kind).toBe("anthropic");
  });
});
