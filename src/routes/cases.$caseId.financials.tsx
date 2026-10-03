import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button, Panel, Stat } from "@/components/ui-kit";
import { calculateCaseDemurrage, getCaseWorkspace } from "@/lib/case.functions";
import { fmtMoney } from "@/lib/case-data";

export const Route = createFileRoute("/cases/$caseId/financials")({
  loader: ({ params }) => getCaseWorkspace({ data: { caseId: params.caseId } }),
  head: () => ({ meta: [{ title: "Financial exposure | CargoIQ" }] }),
  component: FinPage,
});

const defaultTiers = [
  { fromDay: 1, toDay: 5, dailyRate: 175 },
  { fromDay: 6, toDay: 10, dailyRate: 220 },
  { fromDay: 11, dailyRate: 280 },
];

function FinPage() {
  const data = Route.useLoaderData();
  const { caseId } = Route.useParams();
  const router = useRouter();
  const latest = data.calculations[0] as any;
  const [start, setStart] = useState("2026-08-05");
  const [release, setRelease] = useState("2026-08-15");
  const [freeDays, setFree] = useState(5);
  const [units, setUnits] = useState(12);
  const [charged, setCharged] = useState(23100);
  const [result, setResult] = useState<any>(latest ?? null);
  const currency = latest?.currency ?? "USD";

  async function calculate() {
    const row = await calculateCaseDemurrage({
      data: {
        caseId,
        start,
        release,
        freeDays,
        units,
        chargedAmount: charged,
        currency,
        tieredRates: defaultTiers,
        ruleVersion: "DEMURRAGE-SA-2026-v1",
      },
    });
    setResult(row);
    await router.invalidate();
  }

  const calculated = result ? Number(result.calculated_amount_minor) / 100 : 0;
  const chargedAmount = result ? Number(result.charged_amount_minor ?? 0) / 100 : charged;
  const recovery = Math.max(0, chargedAmount - calculated);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Charged" value={fmtMoney(chargedAmount, currency)} tone="disputed" />
        <Stat label="Calculated" value={fmtMoney(calculated, currency)} tone="primary" />
        <Stat label="Variance / recovery" value={fmtMoney(recovery, currency)} tone="observed" />
        <Stat label="Rule" value="DEMURRAGE-SA-2026" />
      </div>

      <Panel title="Deterministic commercial rules">
        <div className="grid gap-4 md:grid-cols-5">
          <label className="text-sm">Start<input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1 w-full rounded border bg-background px-2 py-2" /></label>
          <label className="text-sm">Release<input type="date" value={release} onChange={(e) => setRelease(e.target.value)} className="mt-1 w-full rounded border bg-background px-2 py-2" /></label>
          <label className="text-sm">Free days<input type="number" value={freeDays} onChange={(e) => setFree(Number(e.target.value))} className="mt-1 w-full rounded border bg-background px-2 py-2" /></label>
          <label className="text-sm">Units<input type="number" value={units} onChange={(e) => setUnits(Number(e.target.value))} className="mt-1 w-full rounded border bg-background px-2 py-2" /></label>
          <label className="text-sm">Charged amount<input type="number" value={charged} onChange={(e) => setCharged(Number(e.target.value))} className="mt-1 w-full rounded border bg-background px-2 py-2" /></label>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground"><th className="py-2">Tier</th><th className="py-2">Days</th><th className="py-2">Rate</th></tr></thead>
            <tbody>{defaultTiers.map((t, i) => <tr key={i} className="border-b"><td className="py-2">Tier {i + 1}</td><td className="py-2">{t.fromDay}–{t.toDay ?? "∞"}</td><td className="py-2 font-mono">{currency} {t.dailyRate}</td></tr>)}</tbody>
          </table>
        </div>

        <Button className="mt-5" onClick={calculate}>Calculate & persist audit run</Button>
      </Panel>

      {result && <Panel title="Stored calculation">
        <pre className="overflow-auto text-xs">{JSON.stringify(result.result_payload ?? result, null, 2)}</pre>
      </Panel>}
    </div>
  );
}
