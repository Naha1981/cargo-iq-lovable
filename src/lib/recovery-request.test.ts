import { describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { recoveryRequestKey, clearRecoveryRequest } from "./recovery-request";
vi.stubGlobal("crypto", webcrypto);
function storage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
    m,
  };
}
describe("recovery request reload identity", () => {
  it("reuses uncertain key for same payload after reload, without storing invoice content", async () => {
    const s = storage();
    const a = await recoveryRequestKey(s, "case", { invoice: "PRIVATE invoice", amount: 123 });
    expect(await recoveryRequestKey(s, "case", { invoice: "PRIVATE invoice", amount: 123 })).toBe(
      a,
    );
    expect([...s.m.values()].join("")).not.toContain("PRIVATE");
  });
  it("changed input gets new key; success clear permits intentional new run", async () => {
    const s = storage();
    const a = await recoveryRequestKey(s, "case", { a: 1 });
    const b = await recoveryRequestKey(s, "case", { a: 2 });
    expect(b).not.toBe(a);
    expect(await recoveryRequestKey(s, "case", { a: 1 })).toBe(a);
    await clearRecoveryRequest(s, "case", { a: 2 });
    expect(await recoveryRequestKey(s, "case", { a: 2 })).not.toBe(b);
  });
  it("persistence failure refuses before request rather than losing retry key", async () => {
    const s = storage();
    s.setItem = () => {
      throw new Error("storage refused");
    };
    await expect(recoveryRequestKey(s, "case", {})).rejects.toThrow("storage refused");
  });
});
