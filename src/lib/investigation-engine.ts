export interface DemurrageInput {
  start: string;
  release: string;
  freeDays: number;
  units: number;
  currency: string;
  tieredRates: Array<{ fromDay: number; toDay?: number; dailyRate: number }>;
}

export function calculateDemurrage(input: DemurrageInput) {
  const start = Date.parse(input.start);
  const release = Date.parse(input.release);
  if (!Number.isFinite(start) || !Number.isFinite(release)) throw new Error("INVALID_DATES");
  if (release < start) throw new Error("RELEASE_BEFORE_START");
  const elapsed = Math.max(0, Math.floor((release - start) / 86400000));
  const chargeable = Math.max(0, elapsed - Math.max(0, Math.trunc(input.freeDays)));
  let total = 0;
  const dailyBreakdown: Array<{ day: number; rate: number; amount: number }> = [];
  for (let day = 1; day <= chargeable; day++) {
    const tier =
      input.tieredRates.find((r) => day >= r.fromDay && (r.toDay == null || day <= r.toDay)) ??
      input.tieredRates[input.tieredRates.length - 1];
    if (!tier) throw new Error("NO_RATE_RULE");
    const amount = tier.dailyRate * input.units;
    total += amount;
    dailyBreakdown.push({ day: input.freeDays + day, rate: tier.dailyRate, amount });
  }
  return { elapsed, chargeable, total, currency: input.currency.toUpperCase(), dailyBreakdown };
}
