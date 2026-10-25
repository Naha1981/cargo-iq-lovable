import { describe, expect, it } from "vitest";
import { computeDashboardStats, caseSearchOrFilter } from "./case.functions";
import { caseRecovery } from "./recovery-gate";

// Old client-side derivation (pre-bounded dashboard), replicated verbatim for equivalence.
type OldEnriched = {
  currency: string;
  status: string;
  contradictions: number;
  exposure: number;
  recovery?: number | null;
  clockConflicts?: boolean;
};

function oldDerivation(enriched: OldEnriched[]) {
  const zar = enriched.filter((c) => c.currency === "ZAR");
  return {
    openCases: enriched.filter((c) => c.status !== "CLOSED").length,
    contradictions: enriched.reduce((a, c) => a + c.contradictions, 0),
    exposureZar: zar.reduce((s, c) => s + c.exposure, 0),
    recoveryZar: zar.reduce((s, c) => s + (c.recovery ?? 0), 0),
    recoveryBlocked: zar.some((c) => c.contradictions > 0 || c.clockConflicts),
  };
}

function fixture() {
  const cases = [
    { id: "c1", status: "INVESTIGATING" },
    { id: "c2", status: "CLOSED" },
    { id: "c3", status: "RECOVERY" },
    { id: "c4", status: "APPROVED" }, // no calc row -> currency defaults ZAR, zero amounts
  ];
  const calcs = [
    {
      case_id: "c1",
      calculated_amount_minor: 80000,
      charged_amount_minor: 100000,
      currency: "ZAR",
      created_at: "2026-10-02",
    },
    {
      case_id: "c1",
      calculated_amount_minor: 1,
      charged_amount_minor: 1,
      currency: "ZAR",
      created_at: "2026-10-01",
    }, // older, latest wins
    {
      case_id: "c2",
      calculated_amount_minor: 5000,
      charged_amount_minor: 20000,
      currency: "USD",
      created_at: "2026-10-01",
    },
    {
      case_id: "c3",
      calculated_amount_minor: 50000,
      charged_amount_minor: 90000,
      currency: "ZAR",
      created_at: "2026-10-03",
    },
  ];
  const contradictions = [
    { case_id: "c3", status: "FLAGGED" },
    { case_id: "c3", status: "RESOLVED" },
    { case_id: "c1", status: "FLAGGED" },
  ];
  const blocked = new Set(["c2"]); // USD case with clock conflict
  return { cases, calcs, contradictions, blocked };
}

describe("computeDashboardStats equivalence with previous client derivation", () => {
  it("matches exactly on a mixed fixture (multi-currency, blocked, closed, calc-less)", () => {
    const { cases, calcs, contradictions, blocked } = fixture();
    const latest = new Map<string, (typeof calcs)[number]>();
    for (const r of [...calcs].sort((a, b) => b.created_at.localeCompare(a.created_at)))
      if (!latest.has(r.case_id)) latest.set(r.case_id, r);
    const enriched = cases.map((c) => {
      const calc = latest.get(c.id);
      const contra = contradictions.filter(
        (x) => x.case_id === c.id && x.status === "FLAGGED",
      ).length;
      const clock = blocked.has(c.id);
      const charged = calc?.charged_amount_minor ? calc.charged_amount_minor / 100 : 0;
      const calculated = calc?.calculated_amount_minor ? calc.calculated_amount_minor / 100 : 0;
      return {
        ...c,
        currency: calc?.currency ?? "ZAR",
        exposure: charged,
        recovery: caseRecovery(charged, calculated, contra + (clock ? 1 : 0)),
        contradictions: contra,
        clockConflicts: clock,
      };
    });
    const oldStats = oldDerivation(enriched);
    const orderedCalcs = [...calcs].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const newStats = computeDashboardStats(cases, orderedCalcs, contradictions, blocked);
    expect({
      openCases: newStats.openCases,
      contradictions: newStats.contradictions,
      exposureZar: newStats.exposureZar,
      recoveryZar: newStats.recoveryZar,
      recoveryBlocked: newStats.recoveryBlocked,
    }).toEqual(oldStats);
    expect(newStats.total).toBe(4);
  });

  it("handles empty datasets", () => {
    expect(computeDashboardStats([], [], [], new Set())).toEqual({
      total: 0,
      openCases: 0,
      contradictions: 0,
      exposureZar: 0,
      recoveryZar: 0,
      recoveryBlocked: false,
    });
  });
});

describe("caseSearchOrFilter", () => {
  it("builds an ilike or-filter over the same four fields as the old client filter", () => {
    expect(caseSearchOrFilter("umhlanga")).toBe(
      "reference_no.ilike.%umhlanga%,vessel_name.ilike.%umhlanga%,container_no.ilike.%umhlanga%,port_code.ilike.%umhlanga%",
    );
  });
  it("strips PostgREST or() syntax characters so input cannot break the filter", () => {
    const f = caseSearchOrFilter("a%,(b).c\\d");
    expect(f).not.toMatch(/[()\\]/); // parens/backslash stripped (commas are our own separators)
    expect(f.match(/%/g)).toHaveLength(8); // the only wildcards are our own (4 fields x 2)
    expect(f).toContain("%a b c d%"); // sanitized content remains
  });
  it("collapses whitespace", () => {
    expect(caseSearchOrFilter("  mv   trader ")).toContain("%mv trader%");
  });
});
