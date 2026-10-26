import { requireIntegratedFeatureReady } from "@/lib/integrated-feature-gate";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { tenantMiddleware } from "@/lib/auth-middleware";
import { compareBaselineToScenario, decisionInput, scenarioInput } from "@/lib/simulation";
import type { Json } from "@/integrations/supabase/types";

// Entity audit is written atomically by the proposed database triggers.
// Deploy only with docs/proposals/feature_atomic_audit.sql after approval.

export const listScenarios = createServerFn({ method: "GET" })
  .validator(z.object({ caseId: z.string().uuid().optional() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    await requireIntegratedFeatureReady(context.supabase);
    let query = context.supabase
      .from("simulation_scenarios")
      .select(
        "id,name,scenario_type,status,severity,corridor,port_code,vessel_name,created_at,decided_at",
      )
      .eq("tenant_id", context.tenantId)
      .order("created_at", { ascending: false });
    if (data.caseId) query = query.contains("evidence_refs", [{ kind: "case", id: data.caseId }]);
    const { data: rows, error } = await query;
    if (error) throw error;
    return rows ?? [];
  });

export const getScenario = createServerFn({ method: "GET" })
  .validator(z.object({ scenarioId: z.string().uuid() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    await requireIntegratedFeatureReady(context.supabase);
    const { data: s, error } = await context.supabase
      .from("simulation_scenarios")
      .select("*")
      .eq("id", data.scenarioId)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!s) throw new Error("SCENARIO_NOT_FOUND");
    const { data: history, error: hErr } = await context.supabase
      .from("simulation_scenario_events")
      .select("action,actor,detail,created_at")
      .eq("scenario_id", data.scenarioId)
      .eq("tenant_id", context.tenantId)
      .order("created_at", { ascending: true });
    if (hErr) throw hErr;
    return { scenario: s, history: history ?? [] };
  });

export const createScenario = createServerFn({ method: "POST" })
  .validator(scenarioInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    await requireIntegratedFeatureReady(context.supabase);
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    if (data.caseId) {
      const { data: caseRow, error: caseError } = await context.supabase
        .from("cases")
        .select("id")
        .eq("id", data.caseId)
        .eq("tenant_id", context.tenantId)
        .maybeSingle();
      if (caseError || !caseRow) throw new Error("Case unavailable in this workspace");
    }
    const assumptions = data.assumptions.map((a) => ({
      ...a,
      label: a.source === "measurement" ? "USER-REPORTED MEASUREMENT (unverified)" : "ASSUMPTION",
    }));
    const { data: row, error } = await context.supabase
      .from("simulation_scenarios")
      .insert({
        tenant_id: context.tenantId,
        name: data.name,
        scenario_type: data.scenarioType,
        area_description: data.areaDescription ?? null,
        port_code: data.portCode ?? null,
        corridor: data.corridor ?? null,
        vessel_name: data.vesselName ?? null,
        starts_at: data.startsAt ?? null,
        ends_at: data.endsAt ?? null,
        severity: data.severity,
        assumptions,
        evidence_refs: data.caseId ? [{ kind: "case", id: data.caseId }] : [],
        created_by: context.user.id,
      })
      .select("*")
      .single();
    if (error) throw error;

    return row;
  });

export const runScenarioComparison = createServerFn({ method: "POST" })
  .validator(z.object({ scenarioId: z.string().uuid() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    await requireIntegratedFeatureReady(context.supabase);
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const { data: s, error } = await context.supabase
      .from("simulation_scenarios")
      .select("*")
      .eq("id", data.scenarioId)
      .eq("tenant_id", context.tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!s) throw new Error("SCENARIO_NOT_FOUND");
    if (s.status === "archived" || s.status === "decided") throw new Error("SCENARIO_READ_ONLY");
    const input = scenarioInput.parse({
      name: s.name,
      scenarioType: s.scenario_type,
      areaDescription: s.area_description ?? undefined,
      portCode: s.port_code ?? undefined,
      corridor: s.corridor ?? undefined,
      vesselName: s.vessel_name ?? undefined,
      startsAt: s.starts_at ?? undefined,
      endsAt: s.ends_at ?? undefined,
      severity: s.severity,
      assumptions: ((s.assumptions ?? []) as { text: string; source: string }[]).map((a) => ({
        text: a.text,
        source: a.source,
      })),
    });
    const caseIds = Array.isArray(s.evidence_refs)
      ? s.evidence_refs.flatMap((r) =>
          r &&
          typeof r === "object" &&
          !Array.isArray(r) &&
          r.kind === "case" &&
          typeof r.id === "string"
            ? [r.id]
            : [],
        )
      : [];
    let casesQuery = context.supabase
      .from("cases")
      .select("id,reference_no,port_code,vessel_name")
      .eq("tenant_id", context.tenantId);
    let eventsQuery = context.supabase
      .from("risk_events")
      .select("id,kind,port_code,corridor,vessel_name,verification_status,observed_at")
      .eq("tenant_id", context.tenantId);
    if (caseIds.length) {
      casesQuery = casesQuery.in("id", caseIds);
      const { data: links, error: linkError } = await context.supabase
        .from("risk_event_case_links")
        .select("event_id")
        .eq("tenant_id", context.tenantId)
        .in("case_id", caseIds);
      if (linkError) throw linkError;
      // No linked events means empty evidence, never a tenant-wide fallback.
      eventsQuery = eventsQuery.in("id", [...new Set((links ?? []).map((l) => l.event_id))]);
    }
    const [casesRes, eventsRes] = await Promise.all([casesQuery, eventsQuery]);
    if (casesRes.error) throw casesRes.error;
    if (eventsRes.error) throw eventsRes.error;
    const caseRows = (casesRes.data ?? []).map((c) => ({ ...c, corridor: null as string | null }));
    const result = compareBaselineToScenario(input, caseRows, eventsRes.data ?? []);
    const evidenceRefs = (eventsRes.data ?? [])
      .filter((e) => result.scopedEventIds.includes(e.id))
      .map((e) => ({ kind: "risk_event", id: e.id, noted_at: new Date().toISOString() }));
    const { data: updated, error: uErr } = await context.supabase
      .from("simulation_scenarios")
      .update({
        status: "compared",
        baseline_metrics: {
          shipmentsTotal: (casesRes.data ?? []).length,
          recordedAt: new Date().toISOString(),
          ...(caseIds.length ? { caseScopeVersion: "1", caseIds } : {}),
        } as never,
        scenario_metrics: result as unknown as unknown as never,
        comparison_summary: {
          labels: ["BASELINE=recorded state", "SCENARIO=hypothetical assumptions"],
          evidenceGaps: result.evidenceGaps,
          insufficientData: result.insufficientData,
        } as never,
        evidence_refs: [
          ...(Array.isArray(s.evidence_refs)
            ? s.evidence_refs.filter(
                (r) => r && typeof r === "object" && !Array.isArray(r) && r.kind === "case",
              )
            : []),
          ...evidenceRefs,
        ],
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.scenarioId)
      .eq("tenant_id", context.tenantId)
      .eq("status", s.status)
      .select("*")
      .single();
    if (uErr) throw uErr;

    return { scenario: updated, comparison: result };
  });

export const recordScenarioDecision = createServerFn({ method: "POST" })
  .validator(decisionInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    await requireIntegratedFeatureReady(context.supabase);
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const { data: updated, error } = await context.supabase
      .from("simulation_scenarios")
      .update({
        status: "decided",
        decision_summary: data.decisionSummary,
        decision_action: data.decisionAction ?? null,
        decided_by: context.user.id,
        decided_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.scenarioId)
      .eq("tenant_id", context.tenantId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!updated) throw new Error("SCENARIO_NOT_FOUND");

    return updated;
  });
