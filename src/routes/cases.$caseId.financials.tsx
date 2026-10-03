import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Panel, Stat } from "@/components/ui-kit";
import { calcDemurrage, fmtMoney } from "@/lib/case-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/cases/$caseId/financials")({
  head: () => ({ meta: [{ title: "Financial exposure | CargoIQ" }, { name: "description", content: "Deterministic demurrage calculation versus charged amount." }] }),
  component: FinPage,
});

const BASE = { rate: 175, units: 12, currency: "USD", rulesVersion: "v2.4 · SC-2025-114" };
const CHARGED = calcDemurrage({ ...BASE, start: "2026-08-04", release: "2026-08-19", freeDays: 4 });

function Choice<T extends string | number>({ label, value, opts, onChange }: { label: string; value: T; opts: { v: T; l: string; s: string }[]; onChange: (v: T) => void }) {
  return (
    <div>
      <div className="mb-2 text-xs text-muted-foreground">{label}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {opts.map((o) => (
          <button key={String(o.v)} onClick={() => onChange(o.v)} className={cn("rounded-md border p-3 text-left", value === o.v ? "border-primary bg-primary/5" : "hover:bg-accent")}>
            <div className="font-mono text-sm">{o.l}</div><div className="text-xs text-muted-foreground">{o.s}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function FinPage() {
  const [start, setStart] = useState("2026-08-05");
  const [release, setRelease] = useState("2026-08-15");
  const [freeDays, setFree] = useState(5);
  const calc = calcDemurrage({ ...BASE, start, release, freeDays });
  const recovery = CHARGED.total - calc.total;
  const max = CHARGED.elapsed;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Charged by carrier" value={fmtMoney(CHARGED.total, "USD")} tone="disputed" />
        <Stat label="CargoIQ calculated" value={fmtMoney(calc.total, "USD")} tone="primary" />
        <Stat label="Potential recovery" value={fmtMoney(recovery, "USD")} tone="observed" />
        <Stat label="Chargeable days" value={`${calc.chargeable} vs ${CHARGED.chargeable}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <Panel title="Day-by-day exposure · per container">
          <div className="space-y-3">
            {[{ name: "Carrier invoice", r: { ...CHARGED, free: 4 }, tone: "disputed" }, { name: "CargoIQ evidence", r: { ...calc, free: freeDays }, tone: "primary" }].map((row) => (
              <div key={row.name}>
                <div className="mb-1 flex justify-between text-xs"><span className="text-muted-foreground">{row.name}</span><span className="font-mono">{row.r.chargeable} chargeable / {row.r.elapsed} elapsed</span></div>
                <div className="flex gap-0.5">
                  {Array.from({ length: max }).map((_, i) => {
                    const offset = row.name === "Carrier invoice" ? 0 : Math.round((Date.parse(start) - Date.parse("2026-08-04")) / 864e5);
                    const d = i - offset;
                    const inRange = d >= 0 && d < row.r.elapsed;
                    const free = inRange && d < row.r.free;
                    return <div key={i} className={cn("h-8 flex-1 rounded-sm", !inRange && "bg-secondary/40", free && "bg-observed/40", inRange && !free && (row.tone === "disputed" ? "bg-disputed/70" : "bg-primary/80"))} />;
                  })}
                </div>
              </div>
            ))}
            <div className="flex justify-between font-mono text-[10px] text-muted-foreground"><span>04 Aug</span><span>19 Aug</span></div>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span><i className="mr-1 inline-block h-2 w-3 rounded-sm bg-observed/40" />Free time</span>
              <span><i className="mr-1 inline-block h-2 w-3 rounded-sm bg-primary/80" />Chargeable (evidenced)</span>
              <span><i className="mr-1 inline-block h-2 w-3 rounded-sm bg-disputed/70" />Chargeable (carrier)</span>
            </div>
          </div>
          <table className="mt-6 w-full font-mono text-sm">
            <tbody className="divide-y">
              {[["Chargeable days", calc.chargeable], ["× Daily rate", fmtMoney(BASE.rate, "USD")], ["× Containers", BASE.units], ["= Calculated", fmtMoney(calc.total, "USD")], ["Charged", fmtMoney(CHARGED.total, "USD")], ["Recovery", fmtMoney(recovery, "USD")]].map(([k, v]) => (
                <tr key={k as string}><td className="py-2 text-muted-foreground">{k}</td><td className="py-2 text-right">{v}</td></tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Commercial rule inputs">
          <div className="space-y-5">
            <Choice label="Start of free time" value={start} onChange={setStart} opts={[{ v: "2026-08-04", l: "04 Aug", s: "Carrier notice (disputed)" }, { v: "2026-08-05", l: "05 Aug", s: "AIS berth (observed)" }]} />
            <Choice label="Release date" value={release} onChange={setRelease} opts={[{ v: "2026-08-19", l: "19 Aug", s: "Carrier invoice" }, { v: "2026-08-15", l: "15 Aug", s: "Terminal release log" }]} />
            <Choice label="Free days" value={freeDays} onChange={setFree} opts={[{ v: 4, l: "4 days", s: "Carrier invoice" }, { v: 5, l: "5 days", s: "Contract §7.2" }]} />
            <dl className="grid grid-cols-2 gap-2 border-t pt-4 font-mono text-xs">
              <dt className="text-muted-foreground">Rate</dt><dd>{fmtMoney(BASE.rate, "USD")}/day/unit</dd>
              <dt className="text-muted-foreground">Currency</dt><dd>{BASE.currency}</dd>
              <dt className="text-muted-foreground">Rules</dt><dd>{BASE.rulesVersion}</dd>
            </dl>
          </div>
        </Panel>
      </div>
    </div>
  );
}
