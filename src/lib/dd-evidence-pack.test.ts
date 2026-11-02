import { describe, expect, it } from "vitest";
import {
  MAERSK_DURBAN_20DRY_2026_04_15 as T,
  recomputeDemurrage,
  versionInForce,
  type TariffVersion,
} from "./dd-tariff";
import { buildFindings, type EvidenceEntry } from "./dd-evidence";
import { checkPortalFit } from "./dd-portal-fit";
import { buildEvidencePackV0, packLines } from "./dd-evidence-pdf";
import { layout } from "./dd-pdf-lite";

const key = {
  carrier: "Maersk",
  port: "Durban",
  equipment: "20DRY",
  chargeType: "demurrage" as const,
};
const V = [T];
const run = (dis: string, out: string, free?: number) => recomputeDemurrage(V, key, dis, out, free);

// Hand calculations: Maersk Durban 20' dry, 3 free days, chargeable day 1 = R2698,
// days 2 and 3 = R4391 each (calendar days 4, 5, 6 from discharge). Synthetic dates.
describe("5 synthetic containers reproduce hand calculations", () => {
  it("C1: 4 days elapsed, 1 chargeable day = 2698", () => {
    const r = run("2026-05-01", "2026-05-05");
    expect(r.knownAmount).toBe(2698);
    expect(r.complete).toBe(true);
  });
  it("C2: 6 days elapsed, 3 chargeable = 2698+4391+4391 = 11480", () => {
    const r = run("2026-05-01", "2026-05-07");
    expect(r.knownAmount).toBe(11480);
    expect(r.complete).toBe(true);
  });
  it("C3: 8 days elapsed, 5 chargeable: 11480 known, 2 days UNKNOWN not extrapolated", () => {
    const r = run("2026-05-01", "2026-05-09");
    expect(r.knownAmount).toBe(11480);
    expect(r.unknownDays).toBe(2);
    expect(r.complete).toBe(false);
    expect(r.days.slice(3).every((d) => d.status === "rate_not_stated")).toBe(true);
  });
  it("C4: days before 15 Apr 2026 have no tariff in force: only day 15 Apr rated (chargeable day 3 = 4391)", () => {
    const r = run("2026-04-10", "2026-04-16", 3);
    expect(r.knownAmount).toBe(4391);
    expect(r.unknownDays).toBe(2);
    expect(r.days[0].status).toBe("no_tariff_in_force");
  });
  it("C5: gate-out inside free time = 0", () => {
    const r = run("2026-05-01", "2026-05-03");
    expect(r.knownAmount).toBe(0);
    expect(r.days.length).toBe(0);
    expect(r.complete).toBe(true);
  });
});

describe("tariff versions", () => {
  it("overlapping versions are unusable", () => {
    const dup: TariffVersion = { ...T, id: "dup" };
    expect(versionInForce([T, dup], key, "2026-05-01")).toBeNull();
  });
  it("respects effectiveTo", () => {
    const old: TariffVersion = {
      ...T,
      id: "old",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2026-04-14",
      tiers: [{ fromDay: 1, dailyRate: 100 }],
      statedThroughDay: 9,
    };
    const vs = [old, T];
    expect(versionInForce(vs, key, "2026-04-14")?.id).toBe("old");
    expect(versionInForce(vs, key, "2026-04-15")?.id).toBe(T.id);
    // 100 + 100 on the old version, 4391 on the new version (n=3), n=4 and 5 unknown
    expect(recomputeDemurrage(vs, key, "2026-04-10", "2026-04-18", 3).knownAmount).toBe(4591);
  });
});

const ev = (over: Partial<EvidenceEntry> = {}): EvidenceEntry => ({
  id: "E1",
  kind: "terminal_notice",
  description: "Synthetic gate outage notice",
  source: "synthetic-notice.pdf",
  capturedAt: "2026-05-05T09:00:00Z",
  suppliedBy: "synthetic user",
  coversFrom: "2026-05-04",
  coversTo: "2026-05-05",
  cause: "terminal",
  status: "VERIFIED",
  ...over,
});

describe("findings", () => {
  const rc = run("2026-05-01", "2026-05-07"); // 11480; days 4,5,6 May
  it("arithmetic discrepancy only when recompute is complete", () => {
    const f = buildFindings({
      recompute: rc,
      invoicedAmount: 13000,
      ledger: [],
      assertedDelayDays: [],
    });
    expect(f.findings).toEqual([
      expect.objectContaining({ category: "arithmetic_discrepancy", amount: 1520 }),
    ]);
    const inc = buildFindings({
      recompute: run("2026-05-01", "2026-05-09"),
      invoicedAmount: 99999,
      ledger: [],
      assertedDelayDays: [],
    });
    expect(inc.findings.length).toBe(0);
    expect(inc.notes[0]).toMatch(/lower bound/);
  });
  it("supported delay days are potentially disputable with amount", () => {
    const f = buildFindings({
      recompute: rc,
      invoicedAmount: 11480,
      ledger: [ev()],
      assertedDelayDays: ["2026-05-04", "2026-05-05"],
    });
    expect(f.findings[0]).toMatchObject({
      category: "potentially_disputable",
      amount: 2698 + 4391,
      evidenceIds: ["E1"],
    });
  });
  it("assertion without usable evidence counts no amount", () => {
    for (const bad of [
      ev({ status: "INFERRED" }),
      ev({ capturedAt: null }),
      ev({ source: " " }),
      ev({ coversTo: "2026-05-04", coversFrom: "2026-05-04" }),
    ]) {
      const f = buildFindings({
        recompute: rc,
        invoicedAmount: 11480,
        ledger: [bad],
        assertedDelayDays: ["2026-05-05"],
      });
      expect(f.findings[0]).toMatchObject({ category: "unsupported_claim", amount: null });
    }
  });
  it("recoverable_claim only with a credit note reference", () => {
    const a = buildFindings({
      recompute: rc,
      invoicedAmount: 11480,
      ledger: [],
      assertedDelayDays: [],
      credit: { creditNoteRef: "", creditAmount: 500 },
    });
    expect(a.findings.some((x) => x.category === "recoverable_claim")).toBe(false);
    const b = buildFindings({
      recompute: rc,
      invoicedAmount: 11480,
      ledger: [],
      assertedDelayDays: [],
      credit: { creditNoteRef: "CN-1", creditAmount: 500 },
    });
    expect(b.findings.some((x) => x.category === "recoverable_claim" && x.amount === 500)).toBe(
      true,
    );
  });
});

describe("portal fit", () => {
  it("unknown carrier is unverified", () => {
    expect(checkPortalFit("Maersk", []).status).toBe("unverified");
  });
  it("Hapag-Lloyd 5 files 5MB", () => {
    const f = (n: number, b = 1000) =>
      Array.from({ length: n }, (_, i) => ({ name: `f${i}.pdf`, bytes: b }));
    expect(checkPortalFit("Hapag-Lloyd", f(5)).status).toBe("ok");
    expect(checkPortalFit("Hapag-Lloyd", f(6)).status).toBe("fails");
    expect(checkPortalFit("Hapag-Lloyd", f(1, 6 * 1024 * 1024)).status).toBe("fails");
  });
});

describe("2-page pack", () => {
  const mk = () => {
    const rc = run("2026-05-01", "2026-05-07");
    const ledger = [ev()];
    const { findings, notes } = buildFindings({
      recompute: rc,
      invoicedAmount: 13000,
      ledger,
      assertedDelayDays: ["2026-05-04", "2026-05-05"],
    });
    return {
      containerNo: "SYNU1234560",
      containerType: "20DRY",
      carrier: "Maersk",
      port: "Durban",
      dates: { discharge: "2026-05-01", gateOut: "2026-05-07" },
      invoice: { no: "INV-SYN-1", amount: 13000, currency: "ZAR" },
      tariff: T,
      recompute: rc,
      findings,
      notes,
      ledger,
      portalFit: checkPortalFit("Maersk", []),
      synthetic: true,
      generatedAt: "2026-10-28",
    };
  };
  it("builds a valid PDF of at most 2 pages with the key numbers", () => {
    const bytes = buildEvidencePackV0(mk());
    const s = new TextDecoder().decode(bytes);
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect((s.match(/\/Type \/Page /g) ?? []).length).toBeLessThanOrEqual(2);
    expect(s).toContain("11480.00");
    expect(s).toContain("1520.00");
    expect(s).toContain("SYNTHETIC DATA");
    expect(s).toContain("potentially_disputable");
  });
  it("refuses to exceed 2 pages", () => {
    const lines = Array.from({ length: 200 }, () => ({ text: "x" }));
    expect(() => layout(lines, 2)).toThrow(/PACK_TOO_LONG/);
    expect(packLines(mk()).length).toBeGreaterThan(10);
  });
});
