// D&D tariff library with effective dates (evidence pack v0).
// A tariff is only used for a day if it was in force on that day. Rates beyond the
// last day a source states are UNKNOWN: the engine never invents an amount.
import { fromDay, toDay } from "./dd-analysis";

export type TariffTier = { fromDay: number; toDay?: number; dailyRate: number };

export interface TariffVersion {
  id: string;
  carrier: string;
  port: string;
  equipment: string; // e.g. "20DRY"
  chargeType: "demurrage" | "detention";
  effectiveFrom: string; // YYYY-MM-DD, inclusive
  effectiveTo?: string | null; // YYYY-MM-DD, inclusive
  freeDays: number;
  tiers: TariffTier[];
  // Last chargeable-day-from-discharge number the source states a rate for.
  // Days after it are UNKNOWN, not extrapolated.
  statedThroughDay: number;
  countingRule: "discharge_to_gate_out";
  source: string;
  synthetic: boolean;
  note?: string;
}

// Maersk South Africa import demurrage, Durban, 20' dry, effective 15 Apr 2026, as
// extracted from https://www.maersk.com/news/articles/2026/03/13/south-africa-import-demurrage-detention-revision-april
// (rows Day 4 to Day 6). Cross-checked 28 Oct against Maersk's PDF (1 April 2026 terms):
// same 20' dry rates, table ends at Day 6, so statedThroughDay stays 6.
export const MAERSK_DURBAN_20DRY_2026_04_15: TariffVersion = {
  id: "maersk-za-durban-20dry-dem-2026-04-15",
  carrier: "Maersk",
  port: "Durban",
  equipment: "20DRY",
  chargeType: "demurrage",
  effectiveFrom: "2026-04-15",
  effectiveTo: null,
  freeDays: 3,
  tiers: [
    { fromDay: 1, toDay: 1, dailyRate: 2698 },
    { fromDay: 2, toDay: 3, dailyRate: 4391 },
  ],
  statedThroughDay: 3, // chargeable days 1..3 = calendar days 4..6 from discharge
  countingRule: "discharge_to_gate_out",
  source:
    "https://www.maersk.com/news/articles/2026/03/13/south-africa-import-demurrage-detention-revision-april",
  synthetic: false,
  note: 'Maersk PDF (1 Apr 2026 terms) lists Day 4 to Day 6 only for Durban, no "Day 6+" row, so later days are UNKNOWN. Free time starts the day after discharge at Durban Pier 1 and Pier 2 only (Maersk PDF): this version counts from the discharge date, so for Pier 1 and Pier 2 the user must check the first chargeable day. The 15 Apr article and the 1 Apr PDF show the same 20 dry rates; reefer rates differ between them, so no reefer data is seeded.',
};

export function versionInForce(
  versions: TariffVersion[],
  key: Pick<TariffVersion, "carrier" | "port" | "equipment" | "chargeType">,
  isoDate: string,
): TariffVersion | null {
  const d = toDay(isoDate);
  const hits = versions.filter(
    (v) =>
      v.carrier === key.carrier &&
      v.port === key.port &&
      v.equipment === key.equipment &&
      v.chargeType === key.chargeType &&
      toDay(v.effectiveFrom) <= d &&
      (v.effectiveTo == null || d <= toDay(v.effectiveTo)),
  );
  if (hits.length !== 1) return null; // none or overlapping = not usable
  return hits[0];
}

export interface RecomputedDay {
  date: string;
  chargeableDay: number;
  versionId: string | null;
  rate: number | null; // null = UNKNOWN
  status: "rated" | "no_tariff_in_force" | "rate_not_stated";
}

export interface Recompute {
  freeDays: number | null;
  freeDaysVersionId: string | null;
  days: RecomputedDay[];
  knownAmount: number;
  unknownDays: number;
  complete: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

// Free days come from the version in force on the discharge date (assumption, recorded).
export function recomputeDemurrage(
  versions: TariffVersion[],
  key: Pick<TariffVersion, "carrier" | "port" | "equipment" | "chargeType">,
  dischargeDate: string,
  gateOutDate: string,
  freeDaysOverride?: number, // contract free time, if the contract differs
): Recompute {
  const dis = toDay(dischargeDate);
  const out = toDay(gateOutDate);
  if (out < dis) throw new Error("GATE_OUT_BEFORE_DISCHARGE");
  const base = versionInForce(versions, key, dischargeDate);
  const freeDays = freeDaysOverride ?? base?.freeDays ?? null;
  if (freeDays == null)
    return {
      freeDays: null,
      freeDaysVersionId: null,
      days: [],
      knownAmount: 0,
      unknownDays: 0,
      complete: false,
    };
  const chargeable = Math.max(0, out - dis - freeDays);
  const days: RecomputedDay[] = [];
  for (let n = 1; n <= chargeable; n++) {
    const date = fromDay(dis + freeDays + n - 1);
    const v = versionInForce(versions, key, date);
    if (!v) {
      days.push({
        date,
        chargeableDay: n,
        versionId: null,
        rate: null,
        status: "no_tariff_in_force",
      });
      continue;
    }
    if (n > v.statedThroughDay) {
      days.push({ date, chargeableDay: n, versionId: v.id, rate: null, status: "rate_not_stated" });
      continue;
    }
    const tier = v.tiers.find((t) => n >= t.fromDay && (t.toDay == null || n <= t.toDay));
    days.push(
      tier
        ? { date, chargeableDay: n, versionId: v.id, rate: tier.dailyRate, status: "rated" }
        : { date, chargeableDay: n, versionId: v.id, rate: null, status: "rate_not_stated" },
    );
  }
  const known = days.filter((d) => d.rate != null);
  return {
    freeDays,
    freeDaysVersionId: base?.id ?? null,
    days,
    knownAmount: r2(known.reduce((s, d) => s + (d.rate as number), 0)),
    unknownDays: days.length - known.length,
    complete: days.length === known.length,
  };
}
