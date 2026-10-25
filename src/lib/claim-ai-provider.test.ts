import { afterEach, describe, expect, it } from "vitest";
import { resolveClaimAiProvider } from "@/lib/extraction.functions";

const keys = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "CLAIM_AI_PROVIDER", "LOVABLE_API_KEY"];
const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of keys) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
const clear = () => {
  for (const k of keys) delete process.env[k];
};

describe("claim AI provider selection", () => {
  it("never selects the billed gateway from the mere presence of LOVABLE_API_KEY", () => {
    // Lovable Cloud injects LOVABLE_API_KEY automatically; credits are money, so only an
    // explicit CLAIM_AI_PROVIDER=gateway may select it.
    clear();
    process.env["LOVABLE_API_KEY"] = "x";
    expect(resolveClaimAiProvider().kind).toBe("none");
  });
  it("reports none when nothing is configured", () => {
    clear();
    expect(resolveClaimAiProvider().kind).toBe("none");
  });
  it("prefers an own key over the gateway", () => {
    clear();
    process.env["LOVABLE_API_KEY"] = "x";
    process.env["ANTHROPIC_API_KEY"] = "a";
    expect(resolveClaimAiProvider().kind).toBe("anthropic");
    process.env["OPENAI_API_KEY"] = "o";
    expect(resolveClaimAiProvider().kind).toBe("openai");
  });
  it("honours CLAIM_AI_PROVIDER when that key exists", () => {
    clear();
    process.env["OPENAI_API_KEY"] = "o";
    process.env["ANTHROPIC_API_KEY"] = "a";
    process.env["CLAIM_AI_PROVIDER"] = "anthropic";
    expect(resolveClaimAiProvider().kind).toBe("anthropic");
  });
});

describe("explicit provider configuration", () => {
  it("does not fall back to a billed gateway when an explicitly selected own key is missing", () => {
    for (const provider of ["openai", "anthropic"]) {
      clear();
      process.env["CLAIM_AI_PROVIDER"] = provider;
      process.env["LOVABLE_API_KEY"] = "gateway-key";
      expect(() => resolveClaimAiProvider()).toThrow("not configured");
    }
  });
  it("honors an explicit gateway even when an own key exists", () => {
    clear();
    process.env["CLAIM_AI_PROVIDER"] = "gateway";
    process.env["OPENAI_API_KEY"] = "own-key";
    process.env["LOVABLE_API_KEY"] = "gateway-key";
    expect(resolveClaimAiProvider().kind).toBe("gateway");
  });
  it("rejects unknown provider names instead of silently switching providers", () => {
    clear();
    process.env["CLAIM_AI_PROVIDER"] = "typo";
    process.env["LOVABLE_API_KEY"] = "gateway-key";
    expect(() => resolveClaimAiProvider()).toThrow("Unknown CLAIM_AI_PROVIDER");
  });
  it("reports a missing explicit gateway key", () => {
    clear();
    process.env["CLAIM_AI_PROVIDER"] = "gateway";
    expect(() => resolveClaimAiProvider()).toThrow("LOVABLE_API_KEY is not configured");
  });
});
