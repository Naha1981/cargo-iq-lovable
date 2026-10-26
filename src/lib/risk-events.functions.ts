import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { tenantMiddleware } from "@/lib/auth-middleware";
import { fetchPortConditions } from "@/lib/adapters/weather-port-adapter";
import { resolvePortCenter } from "@/lib/port-centers";
import type { Database, Json } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_WEATHER_THRESHOLDS,
  alertStatusInput,
  assessPortConditions,
  buildAlertDraft,
  computeDedupeKey,
  correlateEventToCases,
  costRecoveryInput,
  manualLinkInput,
  riskEventInput,
  selectWeatherAssessment,
  sourceConfigInput,
  verificationStatusForDecision,
  verifyAlertInput,
  type AlertSeverity,
  type RiskEventInputParsed,
  type WeatherThresholds,
} from "@/lib/risk-events";

const OPEN_STATUSES = ["open", "acknowledged"] as const;

async function insertAlertsForEvent(
  ctx: { supabase: SupabaseClient<Database>; tenantId: string; userId: string },
  event: {
    id: string;
    kind: string;
    source: string;
    title: string;
    summary: string | null;
    observed_at: string;
    source_ref: string | null;
    port_code: string | null;
    vessel_name: string | null;
    corridor: string | null;
  },
  severityHint: AlertSeverity = "watch",
): Promise<{ links: number; alerts: number }> {
  const { data: caseRows, error: caseErr } = await ctx.supabase
    .from("cases")
    .select("id, reference_no, port_code, vessel_name, container_no")
    .eq("tenant_id", ctx.tenantId);
  if (caseErr) throw caseErr;
  const candidates = correlateEventToCases(
    {
      kind: event.kind as RiskEventInputParsed["kind"],
      portCode: event.port_code,
      vesselName: event.vessel_name,
      corridor: event.corridor,
    },
    caseRows ?? [],
  );
  let links = 0;
  let alerts = 0;
  for (const cand of candidates) {
    const caseRef = (caseRows ?? []).find((c) => c.id === cand.caseId)?.reference_no ?? cand.caseId;
    const { error: linkErr } = await ctx.supabase.from("risk_event_case_links").insert({
      tenant_id: ctx.tenantId,
      event_id: event.id,
      case_id: cand.caseId,
      match_basis: cand.matchBasis,
      rationale: cand.rationale,
      confidence: cand.confidence,
      created_by: ctx.userId,
    });
    if (linkErr) {
      if (linkErr.code === "23505") continue;
      throw linkErr;
    }
    links += 1;
    const { data: existing } = await ctx.supabase
      .from("risk_alerts")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("event_id", event.id)
      .eq("case_id", cand.caseId)
      .in("status", [...OPEN_STATUSES])
      .limit(1);
    if (existing && existing.length > 0) continue;
    const draft = buildAlertDraft({
      event: {
        kind: event.kind as RiskEventInputParsed["kind"],
        source: event.source as RiskEventInputParsed["source"],
        title: event.title,
        summary: event.summary,
        observedAt: event.observed_at,
        sourceRef: event.source_ref,
      },
      link: cand,
      caseRef,
      severity: severityHint,
    });
    const { error: alertErr } = await ctx.supabase.from("risk_alerts").insert({
      tenant_id: ctx.tenantId,
      event_id: event.id,
      case_id: cand.caseId,
      severity: draft.severity,
      headline: draft.headline,
      risk_explanation: draft.risk_explanation,
      evidence_summary: draft.evidence_summary,
      confidence: draft.confidence,
      likely_impact: draft.likely_impact,
      recommended_action: draft.recommended_action,
    });
    if (alertErr) {
      if (alertErr.code === "23505") continue;
      throw alertErr;
    }
    alerts += 1;
  }
  return { links, alerts };
}

export const ingestRiskEvent = createServerFn({ method: "POST" })
  .validator(riskEventInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const dedupe = computeDedupeKey({
      source: data.source,
      kind: data.kind,
      observedAt: data.observedAt,
      title: data.title,
      portCode: data.portCode,
      vesselName: data.vesselName,
    });
    const row = {
      tenant_id: context.tenantId,
      source: data.source,
      kind: data.kind,
      title: data.title,
      summary: data.summary ?? null,
      observed_at: data.observedAt,
      latitude: data.latitude ?? null,
      longitude: data.longitude ?? null,
      port_code: data.portCode ?? null,
      corridor: data.corridor ?? null,
      vessel_name: data.vesselName ?? null,
      confidence: data.confidence,
      source_ref: data.sourceRef ?? null,
      dedupe_key: dedupe,
      raw: (data.raw ?? null) as Json,
      created_by: context.user.id,
    };
    const { data: inserted, error } = await context.supabase
      .from("risk_events")
      .insert(row)
      .select("*")
      .single();
    let event = inserted;
    if (error) {
      if (error.code !== "23505") throw error;
      const { data: existing, error: readErr } = await context.supabase
        .from("risk_events")
        .select("*")
        .eq("tenant_id", context.tenantId)
        .eq("dedupe_key", dedupe)
        .single();
      if (readErr) throw readErr;
      event = existing;
    }
    if (!event) throw new Error("RISK_EVENT_INSERT_FAILED");
    const spread = await insertAlertsForEvent(
      { supabase: context.supabase, tenantId: context.tenantId, userId: context.user.id },
      event,
    );
    return { event, duplicate: !!error, ...spread };
  });

export const capturePortWeather = createServerFn({ method: "POST" })
  .validator(z.object({ portCode: z.string().trim().min(2).max(12) }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const { data: config } = await context.supabase
      .from("risk_source_configs")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .eq("source", "open_meteo")
      .maybeSingle();
    if (config && !config.enabled) return { captured: false as const, reason: "SOURCE_DISABLED" };
    const maxPerDay = (config?.max_events_per_day as number | undefined) ?? 100;
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count } = await context.supabase
      .from("risk_events")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", context.tenantId)
      .eq("source", "open_meteo")
      .gte("ingested_at", since);
    if ((count ?? 0) >= maxPerDay)
      return { captured: false as const, reason: "DAILY_CAP_REACHED", maxPerDay };

    const [latitude, longitude] = resolvePortCenter(data.portCode);
    const series = await fetchPortConditions({ latitude, longitude });
    const latest = series[series.length - 1];
    if (!latest) return { captured: false as const, reason: "NO_WEATHER_DATA" };
    const settings = (config?.settings ?? {}) as Record<string, unknown>;
    const thresholds: WeatherThresholds = {
      windSpeedWarnKmh:
        Number(settings.windSpeedWarnKmh) || DEFAULT_WEATHER_THRESHOLDS.windSpeedWarnKmh,
      waveHeightWarnM:
        Number(settings.waveHeightWarnM) || DEFAULT_WEATHER_THRESHOLDS.waveHeightWarnM,
    };
    const selection = selectWeatherAssessment(series, new Date(), thresholds);
    const chosen = selection.current ?? selection.forecast;
    if (!chosen)
      return {
        captured: false as const,
        reason: "CONDITIONS_BELOW_THRESHOLD",
        conditions: latest,
        forecastChecked: selection.forecast !== null,
      };

    const portCode = data.portCode.trim().toUpperCase();
    const title =
      chosen.kind === "forecast"
        ? `Forecast adverse weather near ${portCode} (valid ${chosen.validTime}): ${chosen.reasons.join(" ")}`
        : `Adverse weather near ${portCode}: ${chosen.reasons.join(" ")}`;
    // observed_at is the signal's VALID time; retrieval time is ingested_at.
    const observedAt = chosen.validTime;
    const dedupe = computeDedupeKey({
      source: "open_meteo",
      kind: "weather",
      observedAt,
      title,
      portCode,
    });
    const { data: inserted, error } = await context.supabase
      .from("risk_events")
      .insert({
        tenant_id: context.tenantId,
        source: "open_meteo",
        kind: "weather",
        title,
        summary:
          (chosen.kind === "forecast" ? "Forecast (model), not an observation. " : "") +
          chosen.reasons.join(" "),
        observed_at: observedAt,
        latitude,
        longitude,
        port_code: portCode,
        confidence: "medium",
        source_ref: "https://open-meteo.com/ (marine + forecast APIs)",
        dedupe_key: dedupe,
        raw: JSON.parse(
          JSON.stringify({
            dataType: chosen.kind,
            validTime: chosen.validTime,
            retrievedAt: new Date().toISOString(),
            conditions: latest,
          }),
        ) as Json,
        created_by: context.user.id,
      })
      .select("*")
      .single();
    let event = inserted;
    if (error) {
      if (error.code !== "23505") throw error;
      const { data: existing, error: readErr } = await context.supabase
        .from("risk_events")
        .select("*")
        .eq("tenant_id", context.tenantId)
        .eq("dedupe_key", dedupe)
        .single();
      if (readErr) throw readErr;
      event = existing;
    }
    if (!event) throw new Error("RISK_EVENT_INSERT_FAILED");
    const spread = await insertAlertsForEvent(
      { supabase: context.supabase, tenantId: context.tenantId, userId: context.user.id },
      event,
      chosen.severity,
    );
    return { captured: true as const, event, dataType: chosen.kind, validTime: chosen.validTime, conditions: latest, duplicate: !!error, ...spread };
  });

export const listRiskEvents = createServerFn({ method: "GET" })
  .validator(
    z.object({
      windowHours: z
        .number()
        .int()
        .min(1)
        .max(24 * 30)
        .default(24),
      kind: z.string().nullish(),
      verificationStatus: z.string().nullish(),
    }),
  )
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("risk_events")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .order("observed_at", { ascending: false })
      .limit(200);
    if (data.kind) q = q.eq("kind", data.kind);
    if (data.verificationStatus) q = q.eq("verification_status", data.verificationStatus);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

export const listCaseRiskTimeline = createServerFn({ method: "GET" })
  .validator(z.object({ caseId: z.string().uuid() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    const { data: links, error: linkErr } = await context.supabase
      .from("risk_event_case_links")
      .select("*, risk_events(*)")
      .eq("tenant_id", context.tenantId)
      .eq("case_id", data.caseId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (linkErr) throw linkErr;
    const { data: alerts, error: alertErr } = await context.supabase
      .from("risk_alerts")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .eq("case_id", data.caseId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (alertErr) throw alertErr;
    const { data: costs, error: costErr } = await context.supabase
      .from("cost_recovery_links")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .eq("case_id", data.caseId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (costErr) throw costErr;
    return { links: links ?? [], alerts: alerts ?? [], costs: costs ?? [] };
  });

export const listRiskAlerts = createServerFn({ method: "GET" })
  .validator(z.object({ status: z.string().nullish() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("risk_alerts")
      .select("*, risk_events(title, kind, source, observed_at, source_ref)")
      .eq("tenant_id", context.tenantId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

export const linkRiskEventToCase = createServerFn({ method: "POST" })
  .validator(manualLinkInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const { data: event, error: evErr } = await context.supabase
      .from("risk_events")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .eq("id", data.eventId)
      .single();
    if (evErr) throw evErr;
    const { data: caseRow, error: caseErr } = await context.supabase
      .from("cases")
      .select("id, reference_no")
      .eq("tenant_id", context.tenantId)
      .eq("id", data.caseId)
      .single();
    if (caseErr) throw caseErr;
    const { error: linkErr } = await context.supabase.from("risk_event_case_links").insert({
      tenant_id: context.tenantId,
      event_id: data.eventId,
      case_id: data.caseId,
      match_basis: "manual",
      rationale: data.rationale,
      confidence: "medium",
      created_by: context.user.id,
    });
    if (linkErr && linkErr.code !== "23505") throw linkErr;
    const spread = await insertAlertsForEvent(
      { supabase: context.supabase, tenantId: context.tenantId, userId: context.user.id },
      event,
    );
    return { linked: !linkErr, caseReference: caseRow.reference_no, ...spread };
  });

export const verifyRiskAlert = createServerFn({ method: "POST" })
  .validator(verifyAlertInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const { data: alert, error: alertErr } = await context.supabase
      .from("risk_alerts")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .eq("id", data.alertId)
      .single();
    if (alertErr) throw alertErr;
    const { error: vErr } = await context.supabase.from("risk_alert_verifications").insert({
      tenant_id: context.tenantId,
      alert_id: data.alertId,
      decision: data.decision,
      notes: data.notes ?? null,
      decided_by: context.user.id,
    });
    if (vErr) throw vErr;
    const status = verificationStatusForDecision(data.decision);
    const { error: upErr } = await context.supabase
      .from("risk_alerts")
      .update({ verification_status: status, updated_at: new Date().toISOString() })
      .eq("tenant_id", context.tenantId)
      .eq("id", data.alertId);
    if (upErr) throw upErr;
    // Deliberately NOT updating risk_events.verification_status here: the
    // event is shared across cases, and one case's verdict must not change
    // what other cases see. Case-scoped truth lives on the alert and in
    // risk_alert_verifications; the UI derives per-case event state from it.
    return { alertId: data.alertId, verificationStatus: status };
  });

export const updateAlertStatus = createServerFn({ method: "POST" })
  .validator(alertStatusInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const { error } = await context.supabase
      .from("risk_alerts")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("tenant_id", context.tenantId)
      .eq("id", data.alertId);
    if (error) throw error;
    return { alertId: data.alertId, status: data.status };
  });

export const linkCostRecovery = createServerFn({ method: "POST" })
  .validator(costRecoveryInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    if (!data.alertId && !data.eventId) throw new Error("ALERT_OR_EVENT_REQUIRED");
    const { data: row, error } = await context.supabase
      .from("cost_recovery_links")
      .insert({
        tenant_id: context.tenantId,
        alert_id: data.alertId ?? null,
        event_id: data.eventId ?? null,
        case_id: data.caseId,
        cost_category: data.costCategory,
        amount: data.amount ?? null,
        currency: data.currency,
        evidence_ref: data.evidenceRef ?? null,
        notes: data.notes ?? null,
        created_by: context.user.id,
      })
      .select("*")
      .single();
    if (error) throw error;
    return row;
  });

export const updateCostRecoveryStatus = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.string().uuid(),
      status: z.enum([
        "potential",
        "under_investigation",
        "recoverable",
        "recovered",
        "not_recoverable",
      ]),
    }),
  )
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role))
      throw new Error("Investigator access required");
    const { error } = await context.supabase
      .from("cost_recovery_links")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("tenant_id", context.tenantId)
      .eq("id", data.id);
    if (error) throw error;
    return { id: data.id, status: data.status };
  });

export const listRiskSourceConfigs = createServerFn({ method: "GET" })
  .validator(z.object({}))
  .middleware([tenantMiddleware])
  .handler(async ({ context }) => {
    const { data: rows, error } = await context.supabase
      .from("risk_source_configs")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .order("source");
    if (error) throw error;
    return rows ?? [];
  });

export const upsertRiskSourceConfig = createServerFn({ method: "POST" })
  .validator(sourceConfigInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (context.role !== "admin") throw new Error("Admin access required");
    const { data: row, error } = await context.supabase
      .from("risk_source_configs")
      .upsert(
        {
          tenant_id: context.tenantId,
          source: data.source,
          enabled: data.enabled,
          settings: data.settings as Json,
          max_events_per_day: data.maxEventsPerDay,
          updated_by: context.user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,source" },
      )
      .select("*")
      .single();
    if (error) throw error;
    return row;
  });
