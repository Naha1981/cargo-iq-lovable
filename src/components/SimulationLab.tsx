import { useCallback, useEffect, useState } from "react";
import { Panel, Button } from "@/components/ui-kit";
import {
  createScenario,
  getScenario,
  listScenarios,
  recordScenarioDecision,
  runScenarioComparison,
} from "@/lib/simulation.functions";
import { SCENARIO_TYPES, SEVERITIES } from "@/lib/simulation";
import type { Database } from "@/integrations/supabase/types";

type ScenarioRow = Database["public"]["Tables"]["simulation_scenarios"]["Row"];
type AuditRow = Database["public"]["Tables"]["simulation_scenario_events"]["Row"];

const tone = (v: string) =>
  v === "insufficient" ? "bg-red-500/15 text-red-400" : "bg-emerald-500/15 text-emerald-400";

export function SimulationLab({ caseId, portCode }: { caseId: string; portCode: string | null }) {
  const [scenarios, setScenarios] = useState<ScenarioRow[]>([]);
  const [selected, setSelected] = useState<ScenarioRow | null>(null);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [scenarioType, setScenarioType] = useState<string>(SCENARIO_TYPES[0]);
  const [severity, setSeverity] = useState<string>(SEVERITIES[1]);
  const [assumptionText, setAssumptionText] = useState("");
  const [corridor, setCorridor] = useState("");
  const [vessel, setVessel] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [decisionAction, setDecisionAction] = useState("");
  const [decisionSummary, setDecisionSummary] = useState("");

  const refresh = useCallback(async () => {
    const rows = await listScenarios();
    setScenarios(rows as ScenarioRow[]);
  }, []);

  useEffect(() => {
    refresh().catch((e: Error) => setError(e.message));
  }, [refresh]);

  const open = async (id: string) => {
    const data = await getScenario({ data: { scenarioId: id } });
    setSelected(data.scenario as ScenarioRow);
    setAudit(data.history as AuditRow[]);
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const comparison = selected?.comparison_summary as {
    insufficientData?: string[];
    evidenceGaps?: string[];
  } | null;

  return (
    <div className="space-y-6">
      <Panel title="Simulation Lab">
        <p className="mb-4 text-xs text-muted-foreground">
          Hypothetical what-if analysis. BASELINE figures are recorded case data; SCENARIO figures
          come only from your assumptions. Nothing here changes case records.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">New scenario</h3>
            <input
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              placeholder="Scenario name (e.g. 3-day Durban port closure)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <div className="flex gap-2">
              <select
                className="rounded border bg-background px-2 py-1.5 text-sm"
                value={scenarioType}
                onChange={(e) => setScenarioType(e.target.value)}
              >
                {SCENARIO_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select
                className="rounded border bg-background px-2 py-1.5 text-sm"
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <input
              className="w-full rounded border bg-background px-2 py-1.5 text-sm"
              placeholder="Assumption and its source (e.g. port authority advisory of 20 Oct)"
              value={assumptionText}
              onChange={(e) => setAssumptionText(e.target.value)}
            />
            <label className="block text-xs">
              Corridor scope (exact recorded name)
              <input
                className="mt-1 w-full rounded border bg-background p-2 text-sm"
                value={corridor}
                onChange={(e) => setCorridor(e.target.value)}
                placeholder="e.g. N3"
              />
            </label>
            <label className="block text-xs">
              Vessel scope
              <input
                className="mt-1 w-full rounded border bg-background p-2 text-sm"
                value={vessel}
                onChange={(e) => setVessel(e.target.value)}
                placeholder="Exact recorded vessel name"
              />
            </label>
            <label className="block text-xs">
              Scenario starts (local time)
              <input
                type="datetime-local"
                className="mt-1 w-full rounded border bg-background p-2"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </label>
            <label className="block text-xs">
              Scenario ends (local time)
              <input
                type="datetime-local"
                className="mt-1 w-full rounded border bg-background p-2"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Shared port/corridor/vessel is candidate scope, not proven shipment exposure. Event
              evidence is limited to the selected time window. Case corridor fields are not recorded
              in the current case schema.
            </p>
            <Button
              disabled={busy || !name.trim() || !assumptionText.trim()}
              onClick={() =>
                run(async () => {
                  await createScenario({
                    data: {
                      name: name.trim(),
                      scenarioType: scenarioType as never,
                      severity: severity as never,
                      portCode: portCode ?? undefined,
                      corridor: corridor.trim() || undefined,
                      vesselName: vessel.trim() || undefined,
                      startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
                      endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
                      assumptions: [{ text: assumptionText.trim(), source: "user" }],
                    },
                  });
                  setName("");
                  setAssumptionText("");
                })
              }
            >
              Create scenario
            </Button>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Scenario history ({scenarios.length})</h3>
            {scenarios.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No scenarios yet. Create one to compare a hypothetical disruption against the
                recorded baseline.
              </p>
            )}
            {scenarios.map((s) => (
              <button
                key={s.id}
                onClick={() => open(s.id).catch((e) => setError(e.message))}
                className="block w-full rounded border px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <div className="flex justify-between">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.scenario_type} · {s.severity} · {s.status}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(s.created_at).toLocaleString("en-GB")}
                  {s.decision_action ? " · decision: " + s.decision_action : ""}
                </div>
              </button>
            ))}
          </div>
        </div>
      </Panel>

      {selected && (
        <Panel title={"Comparison: " + selected.name}>
          <p className="mb-4 text-xs text-muted-foreground">
            BASELINE = recorded state. SCENARIO = hypothetical assumptions. No future prediction is
            made or implied.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                Baseline (recorded)
              </h4>
              <pre className="overflow-auto rounded bg-muted p-3 text-xs">
                {JSON.stringify(selected.baseline_metrics, null, 2)}
              </pre>
              <h4 className="mb-2 mt-4 text-xs font-semibold uppercase text-muted-foreground">
                Scenario (hypothetical)
              </h4>
              <pre className="overflow-auto rounded bg-muted p-3 text-xs">
                {JSON.stringify(selected.scenario_metrics, null, 2)}
              </pre>
            </div>
            <div className="space-y-3">
              {comparison?.insufficientData &&
                Object.keys(comparison.insufficientData).length > 0 && (
                  <div>
                    <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                      Insufficient data
                    </h4>
                    {comparison.insufficientData.map((message) => (
                      <p
                        key={message}
                        className={`mb-1 rounded px-2 py-1 text-xs ${tone("insufficient")}`}
                      >
                        {message}
                      </p>
                    ))}
                  </div>
                )}
              {comparison?.evidenceGaps && comparison.evidenceGaps.length > 0 && (
                <div>
                  <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                    Evidence gaps
                  </h4>
                  <ul className="list-inside list-disc text-xs text-muted-foreground">
                    {comparison.evidenceGaps.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                </div>
              )}
              {selected.status !== "compared" && selected.status !== "decided" && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await runScenarioComparison({ data: { scenarioId: selected.id } });
                      await open(selected.id);
                    })
                  }
                >
                  Run baseline comparison
                </Button>
              )}
              <div className="space-y-2 border-t pt-3">
                <h4 className="text-xs font-semibold uppercase text-muted-foreground">
                  Record decision
                </h4>
                <input
                  className="w-full rounded border bg-background px-2 py-1.5 text-sm"
                  placeholder="Action taken or planned (e.g. reroute via Maputo)"
                  value={decisionAction}
                  onChange={(e) => setDecisionAction(e.target.value)}
                />
                <textarea
                  className="w-full rounded border bg-background px-2 py-1.5 text-sm"
                  rows={2}
                  placeholder="Decision summary"
                  value={decisionSummary}
                  onChange={(e) => setDecisionSummary(e.target.value)}
                />
                <Button
                  disabled={busy || !decisionAction.trim() || !decisionSummary.trim()}
                  onClick={() =>
                    run(async () => {
                      await recordScenarioDecision({
                        data: {
                          scenarioId: selected.id,
                          decisionAction: decisionAction.trim(),
                          decisionSummary: decisionSummary.trim(),
                        },
                      });
                      await open(selected.id);
                    })
                  }
                >
                  Record decision
                </Button>
              </div>
            </div>
          </div>
        </Panel>
      )}

      {selected && audit.length > 0 && (
        <Panel title="Scenario audit trail">
          <p className="mb-3 text-xs text-muted-foreground">
            Immutable record of who did what, when.
          </p>
          <ul className="space-y-1 text-xs">
            {audit.map((a) => (
              <li key={a.id} className="flex justify-between border-b border-muted pb-1">
                <span className="font-mono">{a.action}</span>
                <span className="text-muted-foreground">
                  {new Date(a.created_at).toLocaleString("en-GB")} · {a.actor ?? "system"}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
