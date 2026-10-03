export type EvidenceClass =
  | "CUSTOMER_PRIMARY"
  | "CONTRACTUAL"
  | "OFFICIAL_PUBLIC"
  | "LICENSED_COMMERCIAL"
  | "INDEPENDENT_OBSERVATION"
  | "DERIVED"
  | "INFERRED"
  | "DISPUTED"
  | "UNKNOWN";

export type Nature = "observed" | "reported" | "derived" | "inferred" | "disputed";

export const NATURE_LABEL: Record<Nature, string> = {
  observed: "Observed",
  reported: "Reported",
  derived: "Derived",
  inferred: "Inferred",
  disputed: "Disputed",
};

export const fmtMoney = (n: number, currency: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
