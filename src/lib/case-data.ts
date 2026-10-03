export type EvidenceClass =
  | "CUSTOMER_PRIMARY" | "CONTRACTUAL" | "OFFICIAL_PUBLIC" | "LICENSED_COMMERCIAL"
  | "INDEPENDENT_OBSERVATION" | "DERIVED" | "INFERRED" | "DISPUTED" | "UNKNOWN";
export type Nature = "observed" | "reported" | "derived" | "inferred" | "disputed";

export const NATURE_LABEL: Record<Nature, string> = {
  observed: "Observed", reported: "Reported", derived: "Derived", inferred: "Inferred", disputed: "Disputed",
};

export interface CaseSummary {
  id: string; title: string; type: string; counterparty: string; port: string;
  status: "Investigating" | "In review" | "Approved" | "Recovery";
  exposure: number; recovery: number; currency: string; opened: string; contradictions: number;
}

export const CASES: CaseSummary[] = [
  { id: "CIQ-2026-0142", title: "MSC Aurora — demurrage on 12 × 40HC", type: "Demurrage", counterparty: "Meridian Line", port: "Durban", status: "Investigating", exposure: 21000, recovery: 10500, currency: "USD", opened: "2026-09-02", contradictions: 3 },
  { id: "CIQ-2026-0139", title: "Pier 2 truck waiting time — Sept batch", type: "Truck waiting time", counterparty: "Coastline Haulage", port: "Durban", status: "In review", exposure: 48200, recovery: 17350, currency: "ZAR", opened: "2026-08-27", contradictions: 5 },
  { id: "CIQ-2026-0131", title: "Detention on reefer equipment", type: "Detention", counterparty: "Atlas Container", port: "Cape Town", status: "Approved", exposure: 9800, recovery: 4200, currency: "USD", opened: "2026-08-11", contradictions: 2 },
  { id: "CIQ-2026-0127", title: "Storage overcharge — Maydon Wharf", type: "Storage", counterparty: "Bayside Terminals", port: "Durban", status: "Recovery", exposure: 132400, recovery: 61900, currency: "ZAR", opened: "2026-07-30", contradictions: 4 },
  { id: "CIQ-2026-0120", title: "Accessorial: hazardous surcharge", type: "Accessorial charges", counterparty: "Meridian Line", port: "Ngqura", status: "Investigating", exposure: 6400, recovery: 6400, currency: "USD", opened: "2026-07-18", contradictions: 1 },
];

export interface TimelineEvent {
  id: string; at: string; label: string; source: string; cls: EvidenceClass; nature: Nature; ref?: string;
}

export const TIMELINE: TimelineEvent[] = [
  { id: "t1", at: "2026-08-03T21:40", label: "Vessel enters Durban anchorage", source: "AIS (licensed feed)", cls: "LICENSED_COMMERCIAL", nature: "observed" },
  { id: "t2", at: "2026-08-04T08:00", label: "Carrier declares containers available", source: "Carrier arrival notice", cls: "CUSTOMER_PRIMARY", nature: "disputed", ref: "DOC-02 p.1" },
  { id: "t3", at: "2026-08-05T06:12", label: "Vessel berths at Pier 2, Berth 203", source: "AIS + Sentinel-1 scene", cls: "INDEPENDENT_OBSERVATION", nature: "observed" },
  { id: "t4", at: "2026-08-05T14:30", label: "Discharge complete (inferred from crane log gap)", source: "Terminal ops record", cls: "INFERRED", nature: "inferred", ref: "DOC-04 p.3" },
  { id: "t5", at: "2026-08-09T23:00", label: "Port congestion advisory — Pier 2", source: "Transnet NPA notice", cls: "OFFICIAL_PUBLIC", nature: "reported" },
  { id: "t6", at: "2026-08-15T10:05", label: "Terminal releases containers to merchant", source: "Terminal release log", cls: "CUSTOMER_PRIMARY", nature: "reported", ref: "DOC-03 p.2" },
  { id: "t7", at: "2026-08-19T00:00", label: "Carrier invoice: release date", source: "Carrier invoice INV-88231", cls: "DISPUTED", nature: "disputed", ref: "DOC-01 p.1" },
  { id: "t8", at: "2026-08-20T00:00", label: "Chargeable days computed by CargoIQ", source: "Rules engine v2.4", cls: "DERIVED", nature: "derived" },
];

export interface Doc { id: string; name: string; kind: string; pages: number; cls: EvidenceClass; claims: number; uploaded: string }
export const DOCS: Doc[] = [
  { id: "DOC-01", name: "Carrier invoice INV-88231.pdf", kind: "Invoice", pages: 2, cls: "CUSTOMER_PRIMARY", claims: 6, uploaded: "2026-09-02" },
  { id: "DOC-02", name: "Arrival notice MSC Aurora.pdf", kind: "Arrival notice", pages: 1, cls: "CUSTOMER_PRIMARY", claims: 3, uploaded: "2026-09-02" },
  { id: "DOC-03", name: "Terminal release log Pier 2.csv", kind: "Ops record", pages: 4, cls: "CUSTOMER_PRIMARY", claims: 12, uploaded: "2026-09-03" },
  { id: "DOC-04", name: "Crane productivity report.pdf", kind: "Ops record", pages: 6, cls: "CUSTOMER_PRIMARY", claims: 4, uploaded: "2026-09-03" },
  { id: "DOC-05", name: "Service contract SC-2025-114.pdf", kind: "Contract", pages: 38, cls: "CONTRACTUAL", claims: 9, uploaded: "2026-09-04" },
];

export interface Contradiction {
  id: string; topic: string; severity: "High" | "Medium" | "Low";
  a: { source: string; value: string; ref: string; nature: Nature };
  b: { source: string; value: string; ref: string; nature: Nature };
  impact: string;
}
export const CONTRADICTIONS: Contradiction[] = [
  { id: "C-1", topic: "Container availability start", severity: "High",
    a: { source: "Carrier arrival notice", value: "04 Aug 2026 08:00", ref: "DOC-02 p.1", nature: "reported" },
    b: { source: "AIS berth arrival", value: "05 Aug 2026 06:12", ref: "AIS track MMSI 636092114", nature: "observed" },
    impact: "Containers cannot be available before the vessel berths. Shifts start by 1 day." },
  { id: "C-2", topic: "Release / gate-out date", severity: "High",
    a: { source: "Carrier invoice", value: "19 Aug 2026", ref: "DOC-01 p.1", nature: "reported" },
    b: { source: "Terminal release log", value: "15 Aug 2026 10:05", ref: "DOC-03 p.2", nature: "reported" },
    impact: "4 additional chargeable days per container if the carrier date is accepted." },
  { id: "C-3", topic: "Free time allowance", severity: "Medium",
    a: { source: "Carrier invoice", value: "4 free days", ref: "DOC-01 p.2", nature: "reported" },
    b: { source: "Service contract §7.2", value: "5 free days", ref: "DOC-05 p.17", nature: "reported" },
    impact: "Contract governs. 1 day per container over-charged." },
];

export interface AuditEntry { at: string; who: string; action: string }
export const AUDIT: AuditEntry[] = [
  { at: "2026-09-02 09:14", who: "T. Naidoo", action: "Case opened" },
  { at: "2026-09-02 09:20", who: "System", action: "5 documents ingested, 34 claims extracted" },
  { at: "2026-09-03 11:02", who: "System", action: "AIS track & 2 Sentinel scenes attached" },
  { at: "2026-09-04 15:47", who: "System", action: "3 contradictions identified" },
  { at: "2026-09-05 10:30", who: "L. Mokoena", action: "Evidence pack v1 generated" },
  { at: "2026-09-08 16:12", who: "L. Mokoena", action: "Evidence pack v2 generated (contract §7.2 added)" },
];

// AIS track: x,y in harbour SVG coords (0-1000 x 0-640), with timestamps
export const AIS_TRACK = [
  { at: "2026-08-03T21:40", x: 960, y: 560, sog: 9.8 },
  { at: "2026-08-04T02:00", x: 900, y: 520, sog: 0.2 },
  { at: "2026-08-04T12:00", x: 880, y: 505, sog: 0.1 },
  { at: "2026-08-05T02:30", x: 780, y: 470, sog: 4.1 },
  { at: "2026-08-05T04:10", x: 640, y: 420, sog: 3.2 },
  { at: "2026-08-05T05:20", x: 520, y: 360, sog: 2.0 },
  { at: "2026-08-05T06:12", x: 430, y: 300, sog: 0.0 },
  { at: "2026-08-15T10:05", x: 430, y: 300, sog: 0.0 },
];

export const SATELLITE = [
  { id: "S1A_IW_20260804", at: "2026-08-04T03:52", sensor: "Sentinel-1 SAR", finding: "Vessel-sized return at anchorage; Berth 203 vacant", cloud: "n/a" },
  { id: "S2B_MSI_20260806", at: "2026-08-06T08:10", sensor: "Sentinel-2 MSI", finding: "Vessel alongside Berth 203", cloud: "12%" },
];

export const fmtMoney = (n: number, c: string) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: c, maximumFractionDigits: 0 }).format(n);
export const fmtDT = (s: string) =>
  new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

// Deterministic demurrage engine
export interface DemurrageInput { start: string; release: string; freeDays: number; rate: number; units: number; currency: string; rulesVersion: string }
export function calcDemurrage(i: DemurrageInput) {
  const day = 86400000;
  const s = Date.UTC(...ymd(i.start)); const r = Date.UTC(...ymd(i.release));
  const elapsed = Math.max(0, Math.round((r - s) / day));
  const chargeable = Math.max(0, elapsed - i.freeDays);
  return { elapsed, chargeable, total: chargeable * i.rate * i.units };
}
function ymd(s: string): [number, number, number] { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return [y, m - 1, d]; }

export function getCase(id: string) { return CASES.find((c) => c.id === id); }
