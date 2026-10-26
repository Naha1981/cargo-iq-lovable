import { describe, expect, it } from "vitest";
import {
  assertValidTransition,
  compareInvoiceLines,
  findingTypeFor,
  summariseDiscrepancies,
  type InvoiceLine,
} from "./revenue-recovery";

const L = (description: string, quantity: number, unitPrice: number): InvoiceLine => ({
  description,
  quantity,
  unitPrice,
  currency: "ZAR",
});

describe("status machine", () => {
  it("allows new -> under_review -> approved -> submitted -> recovered", () => {
    for (const [a, b] of [
      ["new", "under_review"],
      ["under_review", "approved"],
      ["approved", "submitted"],
      ["submitted", "recovered"],
    ] as const) {
      expect(() => assertValidTransition(a, b)).not.toThrow();
    }
  });
  it("blocks recovered before submitted (honest money rule)", () => {
    expect(() => assertValidTransition("new", "recovered")).toThrow(/INVALID_STATUS_TRANSITION/);
    expect(() => assertValidTransition("approved", "recovered")).toThrow(
      /INVALID_STATUS_TRANSITION/,
    );
  });
  it("treats rejected and recovered as terminal", () => {
    expect(() => assertValidTransition("rejected", "under_review")).toThrow();
    expect(() => assertValidTransition("recovered", "submitted")).toThrow();
  });
});

describe("compareInvoiceLines", () => {
  it("finds amount mismatch with exact breakdown", () => {
    const d = compareInvoiceLines([L("THC", 1, 2500)], [L("THC", 1, 2900)]);
    expect(d).toHaveLength(1);
    expect(d[0].kind).toBe("amount_mismatch");
    expect(d[0].difference).toBe(400);
    expect(d[0].breakdown).toContain("+400.00");
  });
  it("flags duplicate charges only for surplus occurrences", () => {
    const d = compareInvoiceLines(
      [L("Storage", 2, 150)],
      [L("Storage", 2, 150), L("Storage", 2, 150)],
    );
    expect(d.map((x) => x.kind)).toEqual(["duplicate_charge"]);
    expect(d[0].difference).toBe(300);
  });
  it("flags missing billing and unexpected supplier charge", () => {
    const d = compareInvoiceLines([L("Documentation fee", 1, 950)], [L("Port pass", 1, 120)]);
    expect(d.map((x) => x.kind).sort()).toEqual(["missing_charge", "unexpected_charge"]);
  });
  it("matches descriptions case-insensitively and whitespace-tolerant", () => {
    const d = compareInvoiceLines(
      [L("Terminal  Handling", 1, 100)],
      [L("terminal handling", 1, 100)],
    );
    expect(d).toHaveLength(0);
  });
  it("refuses mixed currencies", () => {
    expect(() =>
      compareInvoiceLines([{ ...L("x", 1, 1), currency: "USD" }], [L("x", 1, 1)]),
    ).toThrow(/CURRENCY_MISMATCH/);
  });
});

describe("summariseDiscrepancies + findingTypeFor", () => {
  it("sums only positive exposure and counts kinds", () => {
    const d = compareInvoiceLines(
      [L("THC", 1, 2500), L("Storage", 1, 100)],
      [L("THC", 1, 2900), L("Storage", 1, 50), L("Extra", 1, 75)],
    );
    const s = summariseDiscrepancies(d);
    expect(s.currency).toBe("ZAR");
    expect(s.totalExposure).toBe(475);
    expect(s.byKind.amount_mismatch).toBe(2);
    expect(s.byKind.unexpected_charge).toBe(1);
  });
  it("maps discrepancy kinds to finding types", () => {
    expect(findingTypeFor("duplicate_charge")).toBe("duplicate_invoice_charge");
    expect(findingTypeFor("missing_charge")).toBe("missed_billing");
    expect(findingTypeFor("unexpected_charge")).toBe("unmatched_supplier_charge");
    expect(findingTypeFor("amount_mismatch")).toBe("contract_charge_discrepancy");
  });
});

describe("repeated invoice descriptions", () => {
  it("does not reuse actual lines when expected has duplicates", () => {
    const ds = compareInvoiceLines([L("THC", 1, 100), L("THC", 1, 100)], [L("THC", 1, 100)]);
    expect(ds.map((d) => d.kind)).toEqual(["missing_charge"]);
  });
  it("matches equal repeated amounts before fallback regardless of order", () => {
    expect(
      compareInvoiceLines([L("x", 1, 100), L("x", 1, 200)], [L("x", 1, 200), L("x", 1, 100)]),
    ).toEqual([]);
  });
  it("counts each surplus occurrence only once", () => {
    const ds = compareInvoiceLines(
      [L("x", 1, 100), L("x", 1, 100)],
      [L("x", 1, 100), L("x", 1, 100), L("x", 1, 100)],
    );
    expect(ds).toHaveLength(1);
    expect(summariseDiscrepancies(ds).totalExposure).toBe(100);
  });
  it("rejects empty input and invalid financial numbers", () => {
    expect(() => compareInvoiceLines([], [L("x", 1, 1)])).toThrow(/EMPTY_COMPARISON/);
    expect(() => compareInvoiceLines([L("x", 1, Infinity)], [L("x", 1, 1)])).toThrow();
  });
});

it("reserves later exact lines before an earlier same-description mismatch", () => {
  const ds = compareInvoiceLines(
    [L("x", 1, 100), L("x", 1, 200)],
    [L("x", 1, 200), L("x", 1, 300)],
  );
  expect(ds).toHaveLength(1);
  expect(ds[0].expectedAmount).toBe(100);
  expect(ds[0].actualAmount).toBe(300);
});
