import { Route as CaseRoute } from "./cases.$caseId";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Panel, Stat } from "@/components/ui-kit";
import { calculateCaseDemurrage } from "@/lib/case.functions";
import { fmtMoney } from "@/lib/case-data";
import type { Database } from "@/integrations/supabase/types";

type CalcRow = Database["public"]["Tables"]["financial_calculations"]["Row"];

type DemurrageTier = { fromDay: number; toDay?: number; dailyRate: number };

type DemurrageInput = {
  start?: string;
  release?: string;
  freeDays?: number | null;
  units?: number | null;
  dailyRate?: number | null;
  tieredRates?: DemurrageTier[];
};

export const Route = createFileRoute("/cases/$caseId/financials")({
  head: () => ({ meta: [{ title: "Financial exposure | CargoIQ" }] }),
  component: FinPage,
});

function FinPage() {
  const data = CaseRoute.useLoaderData();
  const { caseId } = Route.useParams();
  const router = useRouter();
  // Do not relabel historic non-ZAR amounts or invent inputs for a new case.
  const latest = data.calculations.find((row) => row.currency === "ZAR");
  const input = (latest?.input_payload ?? {}) as DemurrageInput;
  const storedTiers = Array.isArray(input.tieredRates) ? input.tieredRates : null;
  const [start, setStart] = useState<string>(input.start?.slice(0, 10) ?? "");
  const [release, setRelease] = useState<string>(input.release?.slice(0, 10) ?? "");
  const [freeDays, setFree] = useState<string>(
    input.freeDays == null ? "" : String(input.freeDays),
  );
  const [units, setUnits] = useState<string>(input.units == null ? "" : String(input.units));
  const [charged, setCharged] = useState<string>(
    latest?.charged_amount_minor == null ? "" : String(Number(latest.charged_amount_minor) / 100),
  );
  const [dailyRate, setDailyRate] = useState<string>(
    input.dailyRate == null ? "" : String(input.dailyRate),
  );
  const [result, setResult] = useState<CalcRow | null>(latest ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const currency = "ZAR";
  // The displayed rule is the exact rule sent to the calculator.
  const tiers =
    storedTiers ?? (dailyRate === "" ? [] : [{ fromDay: 1, dailyRate: Number(dailyRate) }]);
  const valid = Boolean(
    start &&
    release &&
    release >= start &&
    freeDays !== "" &&
    units !== "" &&
    Number.isInteger(Number(freeDays)) &&
    Number(freeDays) >= 0 &&
    Number(units) > 0 &&
    (charged === "" || Number(charged) >= 0) &&
    tiers.length &&
    tiers.every((t) => Number.isFinite(t.dailyRate) && t.dailyRate >= 0),
  );

  const openContradictions = data.contradictions.filter((c) => c.status === "FLAGGED").length;
  const blocked = openContradictions > 0 || data.clockBlocked;
  const missing = [
    !start && "start date",
    !release && "release date",
    release && start && release < start && "release on or after start",
    freeDays === "" && "free days",
    units === "" && "units",
    !tiers.length && "daily rate",
  ].filter(Boolean) as string[];

  async function calculate() {
    if (!valid || busy || blocked) return;
    setBusy(true);
    setError("");
    try {
      const row = await calculateCaseDemurrage({
        data: {
          caseId,
          start,
          release,
          freeDays: Number(freeDays),
          units: Number(units),
          chargedAmount: charged === "" ? undefined : Number(charged),
          currency,
          tieredRates: tiers,
          ruleVersion: latest?.rule_version ?? "DEMURRAGE-SA-ZAR-v1",
        },
      });
      setResult(row);
      await router.invalidate();
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("BLOCKED")) {
        setError("BLOCKED - reconcile unresolved evidence first.");
        await router.invalidate();
        setBusy(false);
        return;
      }
      setError(
        "Could not save the calculation. Check the dates, units and ZAR rate, then try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const calculated = result ? Number(result.calculated_amount_minor) / 100 : null;
  const chargedAmount =
    result?.charged_amount_minor == null ? null : Number(result.charged_amount_minor) / 100;
  const recovery =
    chargedAmount == null || calculated == null ? null : Math.max(0, chargedAmount - calculated);
  const money = (value: number | null) => (value == null ? "—" : fmtMoney(value, currency));
  const calcLabel = blocked ? "BLOCKED" : result ? money(calculated) : "Not calculable";
  const recoveryLabel = blocked ? "BLOCKED" : result ? money(recovery) : "Not calculable";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Charged (ZAR)"
          value={blocked ? "BLOCKED" : money(chargedAmount)}
          tone="disputed"
        />
        <Stat label="Calculated (ZAR)" value={calcLabel} tone="primary" />
        <Stat label="Variance / recovery (ZAR)" value={recoveryLabel} tone="observed" />
        <Stat
          label="Rule"
          value={blocked ? "BLOCKED" : (result?.rule_version ?? "Not calculated")}
        />
      </div>
      {blocked && (
        <div
          role="alert"
          className="rounded border border-disputed/50 bg-disputed/10 px-4 py-3 text-sm"
        >
          <div className="font-semibold text-disputed">
            BLOCKED - reconcile unresolved evidence first
          </div>
          <div className="mt-1 text-muted-foreground">
            {data.clockBlocked
              ? "Competing operational source clocks must be reconciled with supporting evidence in Operational review. "
              : ""}
            {openContradictions > 0
              ? `${openContradictions} flagged contradiction(s) must also be resolved with evidence. `
              : ""}
            Earlier figures stay hidden until all evidence gates pass.
          </div>
        </div>
      )}
      {!blocked && missing.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Not calculable yet. Missing: {missing.join(", ")}. Nothing is estimated or assumed.
        </p>
      )}
      {latest && !blocked && (
        <p className="text-sm text-muted-foreground">
          Figures above are the stored audit run. Editing inputs does not change them until a new
          calculation is saved.
        </p>
      )}
      {!latest && data.calculations.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Existing calculations use another currency. They have not been converted to ZAR; enter
          supported ZAR inputs for a new run.
        </p>
      )}
      <Panel title="Deterministic commercial rules">
        <div className="grid gap-4 md:grid-cols-5">
          <label className="text-sm">
            Start
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="mt-1 w-full rounded border bg-background px-2 py-2"
            />
          </label>
          <label className="text-sm">
            Release
            <input
              type="date"
              value={release}
              onChange={(e) => setRelease(e.target.value)}
              className="mt-1 w-full rounded border bg-background px-2 py-2"
            />
          </label>
          <label className="text-sm">
            Free days
            <input
              type="number"
              min="0"
              step="1"
              value={freeDays}
              onChange={(e) => setFree(e.target.value)}
              className="mt-1 w-full rounded border bg-background px-2 py-2"
            />
          </label>
          <label className="text-sm">
            Units
            <input
              type="number"
              min="1"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              className="mt-1 w-full rounded border bg-background px-2 py-2"
            />
          </label>
          <label className="text-sm">
            Charged amount (ZAR)
            <input
              type="number"
              min="0"
              value={charged}
              onChange={(e) => setCharged(e.target.value)}
              className="mt-1 w-full rounded border bg-background px-2 py-2"
            />
          </label>
        </div>
        {!storedTiers && (
          <label className="mt-4 block text-sm">
            Daily rate per unit (ZAR)
            <input
              type="number"
              min="0"
              value={dailyRate}
              onChange={(e) => setDailyRate(e.target.value)}
              className="mt-1 w-full rounded border bg-background px-2 py-2"
            />
          </label>
        )}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="py-2">Tier</th>
                <th className="py-2">Chargeable days</th>
                <th className="py-2">Rate per unit</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((t, i: number) => (
                <tr key={i} className="border-b">
                  <td className="py-2">Tier {i + 1}</td>
                  <td className="py-2">
                    {t.fromDay}–{t.toDay ?? "∞"}
                  </td>
                  <td className="py-2 font-mono">{fmtMoney(t.dailyRate, currency)} / day</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!tiers.length && (
            <p className="mt-2 text-sm text-muted-foreground">
              Enter the rate from the contract or invoice. No rate is assumed.
            </p>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-disputed">
            {error}
          </p>
        )}
        <Button disabled={!valid || busy || blocked} className="mt-5" onClick={calculate}>
          {busy
            ? "Saving…"
            : blocked
              ? "Blocked - resolve contradictions"
              : "Calculate & persist audit run"}
        </Button>
      </Panel>
      {result && !blocked && (
        <Panel title="Stored calculation">
          <pre className="overflow-auto text-xs">
            {JSON.stringify(result.result_payload ?? result, null, 2)}
          </pre>
        </Panel>
      )}
    </div>
  );
}
