import { assertDocumentSize } from "./extraction-policy";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { tenantMiddleware } from "@/lib/auth-middleware";
import { sha256Hex, stableCanonical } from "@/lib/hash";
import { resolvePortCenter } from "@/lib/port-centers";
import { caseRecovery } from "@/lib/recovery-gate";
import { calculateDemurrage } from "@/lib/investigation-engine";
import { buildAisBoundingBox, fetchAisSnapshot } from "@/lib/adapters/ais-adapter";
import { querySentinelScenes } from "@/lib/adapters/satellite-adapter";
import { fetchPortConditions } from "@/lib/adapters/weather-port-adapter";
import { extractDocumentClaimsForPath } from "@/lib/extraction.functions";

const idInput = z.object({ caseId: z.string().uuid() });
async function clockBlocked(db: any, caseId: string): Promise<boolean> {
  const { data, error } = await db.rpc("has_unresolved_operational_clocks", { _case_id: caseId });
  if (error) throw error;
  return Boolean(data);
}
async function assertClockGate(db: any, caseId: string) {
  if (await clockBlocked(db, caseId)) throw new Error("BLOCKED: reconcile conflicting operational clock evidence first.");
}


export const listCases = createServerFn({ method: "GET" }).middleware([tenantMiddleware]).handler(async ({ context }) => {
  const { data: cases, error } = await context.supabase.from("cases").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  const ids = (cases ?? []).map((c: any) => c.id);
  const { data: calcs } = ids.length
    ? await context.supabase.from("financial_calculations").select("case_id,calculated_amount_minor,charged_amount_minor,currency,variance_minor").in("case_id", ids).order("created_at", { ascending: false })
    : { data: [] as any[] };
  const { data: contradictions } = ids.length
    ? await context.supabase.from("contradictions").select("case_id,status").in("case_id", ids)
    : { data: [] as any[] };

  const latestCalc = new Map<string, any>();
  for (const row of calcs ?? []) if (!latestCalc.has(row.case_id)) latestCalc.set(row.case_id, row);

  return Promise.all((cases ?? []).map(async (c: any) => {
    const calc = latestCalc.get(c.id);
    const openContradictions = (contradictions ?? []).filter((x: any) => x.case_id === c.id && x.status === "FLAGGED").length;
    const unresolvedClocks = await clockBlocked(context.supabase, c.id);
    const charged = calc?.charged_amount_minor ? Number(calc.charged_amount_minor) / 100 : 0;
    const calculated = calc?.calculated_amount_minor ? Number(calc.calculated_amount_minor) / 100 : 0;
    return { ...c, currency: calc?.currency ?? "ZAR", exposure: charged, recovery: caseRecovery(charged, calculated, openContradictions + (unresolvedClocks ? 1 : 0)), contradictions: openContradictions, clockConflicts: unresolvedClocks };
  }));
});

export const getCase = createServerFn({ method: "GET" }).validator(idInput).middleware([tenantMiddleware]).handler(async ({ data, context }) => {
  const { data: row, error } = await context.supabase.from("cases").select("*").eq("id", data.caseId).maybeSingle();
  if (error) throw error;
  return row;
});

export const createCase = createServerFn({ method: "POST" })
  .validator(z.object({
    referenceNo: z.string().min(3).max(80),
    vesselName: z.string().optional(),
    voyageNo: z.string().optional(),
    containerNo: z.string().optional(),
    portCode: z.string().optional(),
  }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role)) throw new Error("Investigator access required");
    const { data: row, error } = await context.supabase.from("cases").insert({
      tenant_id: context.tenantId,
      reference_no: data.referenceNo,
      vessel_name: data.vesselName || null,
      voyage_no: data.voyageNo || null,
      container_no: data.containerNo || null,
      port_code: data.portCode || null,
      created_by: context.user.id,
    }).select("*").single();
    if (error) throw error;

    await context.supabase.from("audit_log").insert({
      tenant_id: context.tenantId,
      case_id: row.id,
      actor_user_id: context.user.id,
      action: "CASE_CREATED",
      entity_type: "case",
      entity_id: row.id,
      payload: { reference_no: row.reference_no },
    });
    return row;
  });

export const getCaseWorkspace = createServerFn({ method: "GET" }).validator(idInput).middleware([tenantMiddleware]).handler(async ({ data, context }) => {
  const db = context.supabase;
  const [caseRow, documents, claims, contradictions, timeline, observations, calcs, packs] = await Promise.all([
    db.from("cases").select("*").eq("id", data.caseId).maybeSingle(),
    db.from("documents").select("*").eq("case_id", data.caseId).order("uploaded_at", { ascending: false }),
    db.from("extracted_claims").select("*").eq("case_id", data.caseId).order("created_at", { ascending: true }),
    db.from("contradictions").select("*").eq("case_id", data.caseId).order("created_at", { ascending: false }),
    db.from("timeline_events").select("*").eq("case_id", data.caseId).order("timestamp", { ascending: true }),
    db.from("external_observations").select("*").eq("case_id", data.caseId).order("observed_at", { ascending: true }),
    db.from("financial_calculations").select("*").eq("case_id", data.caseId).order("created_at", { ascending: false }),
    db.from("evidence_packs").select("id,version,sha256_hash,status,approved_by,generated_at,pack_payload").eq("case_id", data.caseId).order("version", { ascending: false }),
  ]);
  for (const item of [caseRow, documents, claims, contradictions, timeline, observations, calcs, packs]) if (item.error) throw item.error;
  return {
    tenantId: context.tenantId,
    clockBlocked: await clockBlocked(db, data.caseId),
    case: caseRow.data,
    documents: documents.data ?? [],
    claims: claims.data ?? [],
    contradictions: contradictions.data ?? [],
    timeline: timeline.data ?? [],
    observations: observations.data ?? [],
    calculations: calcs.data ?? [],
    packs: packs.data ?? [],
  };
});

export const registerDocument = createServerFn({ method: "POST" })
  .validator(z.object({
    caseId: z.string().uuid(),
    filePath: z.string().min(5),
    name: z.string().min(1),
    fileType: z.string().min(1),
    sourceParty: z.string().trim().min(2).max(200),
  }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role)) throw new Error("Investigator access required");
    const expectedPrefix = context.tenantId + "/" + data.caseId + "/";
    if (!data.filePath.startsWith(expectedPrefix)) throw new Error("INVALID_STORAGE_PATH");

    const { data: blob, error: downloadError } = await context.supabase.storage.from("case-documents").download(data.filePath);
    if (downloadError || !blob) throw downloadError ?? new Error("DOCUMENT_DOWNLOAD_FAILED");

    assertDocumentSize(blob.size);
    const sha256 = await sha256Hex(await blob.arrayBuffer());
    const { data: row, error } = await context.supabase.from("documents").insert({
      tenant_id: context.tenantId,
      case_id: data.caseId,
      name: data.name,
      file_path: data.filePath,
      file_type: data.fileType,
      sha256_hash: sha256,
      source_party: data.sourceParty || null,
    }).select("*").single();

    if (error) throw error;
    return row;
  });

export const runDocumentExtraction = createServerFn({ method: "POST" })
  .validator(z.object({ documentId: z.string().uuid(), caseId: z.string().uuid(), noAi: z.boolean().optional(), allowTestFallback: z.boolean().optional() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role)) throw new Error("Investigator access required");
    return extractDocumentClaimsForPath({
      ...data,
      tenantId: context.tenantId,
      supabase: context.supabase,
      userId: context.user.id,
    });
  });

export const reviewClaim = createServerFn({ method: "POST" })
  .validator(z.object({ claimId: z.string().uuid(), caseId: z.string().uuid(), decision: z.enum(["VERIFIED","DISPUTED"]) }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role)) throw new Error("Investigator access required");
    const { data: row, error } = await context.supabase.from("extracted_claims").update({
      status: data.decision,
      updated_at: new Date().toISOString(),
    }).eq("id", data.claimId).eq("case_id", data.caseId).select("*").single();
    if (error) throw error;

    await context.supabase.from("audit_log").insert({
      tenant_id: context.tenantId,
      case_id: data.caseId,
      actor_user_id: context.user.id,
      action: "CLAIM_REVIEWED",
      entity_type: "extracted_claim",
      entity_id: data.claimId,
      payload: { decision: data.decision },
    });
    return row;
  });

export const resolveContradiction = createServerFn({ method: "POST" })
  .validator(z.object({ contradictionId: z.string().uuid(), caseId: z.string().uuid(),
    explanation: z.string().trim().min(10).max(4000),
    supportingDocumentId: z.string().uuid(), evidenceReference: z.string().trim().min(3).max(1000) }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role)) throw new Error("Investigator access required");
    // Database trigger validates same-case evidence and records the audit atomically.
    const { data: row, error } = await context.supabase.from("contradictions").update({
      status: "RESOLVED", resolution_note: data.explanation,
      resolution_document_id: data.supportingDocumentId,
      resolution_evidence_reference: data.evidenceReference,
    }).eq("id", data.contradictionId).eq("case_id", data.caseId).eq("status", "FLAGGED").select("*").single();
    if (error) throw error;
    return row;
  });

export const corroborateCase = createServerFn({ method: "POST" })
  .validator(z.object({ caseId: z.string().uuid(), start: z.string(), end: z.string() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role)) throw new Error("Investigator access required");
    const { data: row, error } = await context.supabase.from("cases").select("vessel_name,port_code").eq("id", data.caseId).single();
    if (error || !row) throw error ?? new Error("CASE_NOT_FOUND");

    const center = resolvePortCenter(row.port_code);
    const bbox = buildAisBoundingBox(center, 35);
    const [ais, scenes, weather] = await Promise.all([
      fetchAisSnapshot({ vesselName: row.vessel_name ?? undefined, bbox }),
      querySentinelScenes({ bbox, start: data.start, end: data.end, limit: 12 }),
      fetchPortConditions({ latitude: center[0], longitude: center[1], start: data.start, end: data.end }),
    ]);

    const observations = [
      ...ais.map((x) => ({ source: x.source, observation_type: "AIS_POSITION", observed_at: x.observedAt, latitude: x.latitude, longitude: x.longitude, payload: x, confidence: 0.8, limitation: "AIS corroborates reported vessel position; it does not prove contractual liability." })),
      ...scenes.map((x) => ({ source: "Copernicus Sentinel Data Space", observation_type: x.sensor === "SENTINEL-1" ? "SENTINEL_1_SCENE" : "SENTINEL_2_SCENE", observed_at: x.acquiredAt, latitude: x.bbox ? (x.bbox[1] + x.bbox[3]) / 2 : null, longitude: x.bbox ? (x.bbox[0] + x.bbox[2]) / 2 : null, payload: x, confidence: 0.7, limitation: "Scene metadata corroborates spatial/temporal coverage; imagery requires human inspection before shipment-specific conclusions." })),
      ...weather.slice(0, 48).map((x: any) => ({ source: x.source, observation_type: "MARINE_WEATHER", observed_at: x.time, latitude: center[0], longitude: center[1], payload: x, confidence: 0.6, limitation: "Weather is contextual evidence and does not establish delay responsibility by itself." })),
    ];

    if (observations.length) {
      const { error: insertError } = await context.supabase.from("external_observations").insert(observations.map((x) => ({ tenant_id: context.tenantId, case_id: data.caseId, ...x })));
      if (insertError) throw insertError;
    }

    const aisEvents = ais.slice(0, 50).map((x) => ({
      tenant_id: context.tenantId,
      case_id: data.caseId,
      timestamp: x.observedAt,
      title: (x.vesselName ?? row.vessel_name ?? "Vessel") + " AIS position",
      source: x.source,
      evidence_class: "INDEPENDENT_OBSERVATION",
      nature: "OBSERVED",
      coordinates: { lat: x.latitude, lon: x.longitude },
      provenance_id: null,
    }));

    if (aisEvents.length) {
      const { error: timelineError } = await context.supabase.from("timeline_events").insert(aisEvents);
      if (timelineError) throw timelineError;
    }

    return { ais: ais.length, scenes: scenes.length, weather: weather.length };
  });

export const calculateCaseDemurrage = createServerFn({ method: "POST" })
  .validator(z.object({
    caseId: z.string().uuid(),
    start: z.string(),
    release: z.string(),
    freeDays: z.number().nonnegative(),
    units: z.number().positive(),
    currency: z.literal("ZAR"),
    chargedAmount: z.number().nonnegative().optional(),
    tieredRates: z.array(z.object({ fromDay: z.number().int().positive(), toDay: z.number().int().positive().optional(), dailyRate: z.number().nonnegative() })).min(1),
    ruleVersion: z.string().min(1),
  }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role)) throw new Error("Investigator access required");
    const { data: flaggedRows, error: flaggedError } = await context.supabase
      .from("contradictions").select("id").eq("case_id", data.caseId).eq("status", "FLAGGED").limit(1);
    if (flaggedError) throw flaggedError;
    if (flaggedRows?.length) throw new Error("BLOCKED: resolve open contradictions first.");
    await assertClockGate(context.supabase, data.caseId);
    const result = calculateDemurrage(data);
    const calculatedMinor = Math.round(result.total * 100);
    const chargedMinor = data.chargedAmount == null ? null : Math.round(data.chargedAmount * 100);
    const varianceMinor = chargedMinor == null ? null : chargedMinor - calculatedMinor;

    const { error: ruleError } = await context.supabase.from("commercial_rules").upsert({
      tenant_id: context.tenantId,
      name: "DEMURRAGE",
      rule_version: data.ruleVersion,
      rule_type: "DEMURRAGE",
      currency: data.currency.toUpperCase(),
      payload: { freeDays: data.freeDays, units: data.units, tieredRates: data.tieredRates },
      active: true,
    }, { onConflict: "tenant_id,name,rule_version" });
    if (ruleError) throw ruleError;

    const { data: row, error } = await context.supabase.from("financial_calculations").insert({
      tenant_id: context.tenantId,
      case_id: data.caseId,
      calculation_type: "DEMURRAGE",
      rule_version: data.ruleVersion,
      input_payload: data,
      result_payload: result,
      calculated_amount_minor: calculatedMinor,
      charged_amount_minor: chargedMinor,
      variance_minor: varianceMinor,
      currency: data.currency.toUpperCase(),
      created_by: context.user.id,
    }).select("*").single();
    if (error) throw error;
    return row;
  });

export const generateEvidencePack = createServerFn({ method: "POST" })
  .validator(idInput)
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role)) throw new Error("Investigator access required");
    const db = context.supabase;
    const [c, docs, claims, contradictions, timeline, observations, calculations, existing, definitions, clocks, attributions, kpis, matches, gaps, identityReviews, clockDecisions, countSources, countRules, countComparisons, appointmentLifecycle, authorisedImports] = await Promise.all([
      db.from("cases").select("*").eq("id", data.caseId).single(),
      db.from("documents").select("*").eq("case_id", data.caseId).order("uploaded_at", { ascending: true }),
      db.from("extracted_claims").select("*").eq("case_id", data.caseId).order("created_at", { ascending: true }),
      db.from("contradictions").select("*").eq("case_id", data.caseId).order("created_at", { ascending: true }),
      db.from("timeline_events").select("*").eq("case_id", data.caseId).order("timestamp", { ascending: true }),
      db.from("external_observations").select("*").eq("case_id", data.caseId).order("observed_at", { ascending: true }),
      db.from("financial_calculations").select("*").eq("case_id", data.caseId).order("created_at", { ascending: true }),
      db.from("evidence_packs").select("version,status").eq("case_id", data.caseId).order("version", { ascending: false }),
      db.from("operational_definitions").select("*").eq("case_id", data.caseId).order("created_at", { ascending: true }),
      db.from("operational_clocks").select("*").eq("case_id", data.caseId).order("created_at", { ascending: true }),
      db.from("appointment_attributions").select("*").eq("case_id", data.caseId).order("created_at", { ascending: true }),
      db.from("kpi_definitions").select("*").eq("case_id", data.caseId).order("created_at", { ascending: true }),
      db.from("cross_party_matches").select("*").eq("case_id", data.caseId).order("created_at", { ascending: true }),
      db.from("evidence_gap_entries").select("*").eq("case_id", data.caseId).order("created_at", { ascending: true }),
      db.from("cross_party_match_reviews").select("*").eq("case_id", data.caseId).order("created_at", { ascending: true }),
      db.from("clock_reconciliations").select("*").eq("case_id", data.caseId).order("created_at", { ascending: true }),
      db.from("count_source_records").select("*").eq("case_id", data.caseId).order("created_at", { ascending: true }),
      db.from("count_rule_versions").select("*").eq("case_id", data.caseId).order("created_at", { ascending: true }),
      db.from("count_comparison_definitions").select("*").eq("case_id", data.caseId).order("created_at", { ascending: true }),
      db.from("appointment_lifecycle").select("*").eq("case_id", data.caseId).order("created_at", { ascending: true }),
      db.from("authorised_imports").select("*").eq("case_id", data.caseId).order("created_at", { ascending: true }),
    ]);
    for (const x of [c, docs, claims, contradictions, timeline, observations, calculations, existing, definitions, clocks, attributions, kpis, matches, gaps, identityReviews, clockDecisions, countSources, countRules, countComparisons, appointmentLifecycle, authorisedImports]) if (x.error) throw x.error;

    const unresolved = (contradictions.data ?? []).filter((x: any) => x.status === "FLAGGED").length;
    if (unresolved > 0) throw new Error("Resolve the flagged contradictions before generating an evidence pack.");
    await assertClockGate(db, data.caseId);

    const version = ((existing.data?.[0]?.version as number | undefined) ?? 0) + 1;
    const payload = {
      generatedAt: new Date().toISOString(),
      version,
      case: c.data,
      documents: docs.data ?? [],
      operationalDefinitions: definitions.data ?? [],
      operationalClocks: clocks.data ?? [],
      appointmentAttributions: attributions.data ?? [],
      kpiDefinitions: kpis.data ?? [],
      crossPartyMatches: matches.data ?? [],
      evidenceGapHistory: gaps.data ?? [],
      eventIdentityReviews: identityReviews.data ?? [],
      clockReconciliations: clockDecisions.data ?? [],
      countSourceRecords: countSources.data ?? [],
      countRuleVersions: countRules.data ?? [],
      countComparisons: countComparisons.data ?? [],
      appointmentLifecycle: appointmentLifecycle.data ?? [],
      authorisedImports: authorisedImports.data ?? [],
      countEngineVersion: "1",
      verifiedClaims: (claims.data ?? []).filter((x: any) => x.status === "VERIFIED"),
      claims: claims.data ?? [],
      contradictions: contradictions.data ?? [],
      timeline: timeline.data ?? [],
      externalObservations: observations.data ?? [],
      financialCalculations: calculations.data ?? [],
      approvals: [],
      truthRule: "Public and independent observations are corroboration unless the source directly proves the event. Inference remains inference until human review.",
    };
    const { data: packResult, error: persistError } = await db.rpc("persist_evidence_pack_atomic", {
      _case_id: data.caseId,
      _canonical: stableCanonical(payload),
    });
    if (persistError) throw persistError;
    const pack = Array.isArray(packResult) ? packResult[0] : packResult;
    if (!pack?.id) throw new Error("Atomic evidence-pack persistence returned no pack.");
    const hash = pack.sha256_hash as string;

    const summary = [
      "# CargoIQ Investigation " + (c.data?.reference_no ?? ""),
      "",
      "**Case:** " + (c.data?.reference_no ?? "—"),
      "**Vessel:** " + (c.data?.vessel_name ?? "—"),
      "**Port:** " + (c.data?.port_code ?? "—"),
      "**Evidence pack:** v" + version,
      "**SHA-256:** " + hash,
      "",
      "## Timeline",
      ...(timeline.data ?? []).map((e: any) => "- " + e.timestamp + " — " + e.title + " [" + e.nature + "] — " + e.source),
      "",
      "## Count source records and executable mappings (engine v1)",
      ...(countSources.data ?? []).map((x:any)=>"- "+x.party+" / "+x.physical_reference+" v"+x.version+": "+x.quantity+" "+x.basis+"; evidence "+x.source_document_id+", "+x.source_reference),
      ...(countRules.data ?? []).map((x:any)=>"- Rule "+x.name+" v"+x.version+": "+x.input_basis+" -> "+x.output_unit+", "+x.calculation+" x "+x.numerator+"/"+x.denominator+" ["+x.acceptance+"]"),
      ...(countComparisons.data ?? []).map((x:any)=>"- Common scope "+x.name+" v"+x.version+": "+x.physical_references.join(", ")+"; mappings "+x.rule_ids.join(", ")+"; duration definition "+(x.kpi_definition_id??"none")+" ["+x.acceptance+"]"),
      "",
      "## Appointment lifecycle and human causal review",
      ...(appointmentLifecycle.data ?? []).map((x:any)=>"- "+x.appointment_reference+" / "+x.record_type+" v"+x.version+": "+x.explanation+"; issuer "+x.issuer+"; claim target "+(x.claim_target||"not assessed")+" ["+x.outcome+"]; terms "+x.terms_reference),
      "",
      "## Authorised export provenance (permission is an operator assertion)",
      ...(authorisedImports.data ?? []).map((x:any)=>"- "+x.dataset+" / "+x.row_count+" rows; exported "+x.exported_at+"; SHA256 "+x.raw_sha256+"; authority basis "+x.authorization_basis),
      "",
      "## Operational definitions",
      ...(definitions.data ?? []).map((x: any) => "- " + x.party + " / " + x.metric + " v" + x.version + ": " + x.unit + " [" + x.acceptance + "] - " + x.rule + " (source " + x.source_document_id + ", " + x.source_reference + ")"),
      "",
      "## Clock evidence and appointment attribution",
      ...(clocks.data ?? []).map((x: any) => "- " + x.physical_reference + " " + x.kind + ": " + x.timestamp_original + " (" + x.time_zone + ") - source " + x.source_party + ", " + x.source_document_id + ", " + x.source_reference),
      ...(attributions.data ?? []).map((x: any) => "- Appointment source " + x.appointment_clock_id + ": claimant " + x.claimant + ", target " + x.claim_target + ", assertion " + x.assertion + " - evidence " + x.source_document_id + ", " + x.source_reference),
      "",
      "## KPI definitions and benchmarks",
      ...(kpis.data ?? []).map((x: any) => "- " + x.party + " / " + x.name + " v" + x.version + ": " + x.start_kind + " to " + x.end_kind + " [" + x.acceptance + "] - scope " + x.physical_reference + ", benchmark " + (x.benchmark_hours ?? "not supplied") + "h; " + x.benchmark_basis),
      "",
      "## Cross-party physical-event matches",
      ...(matches.data ?? []).map((x: any) => "- " + x.event_reference + ": " + x.result + ", claims " + x.claim_a_id + " / " + x.claim_b_id + ", rationale " + x.rationale),
      "",
      "## Match review history (retractions and reaffirmations)",
      ...(identityReviews.data ?? []).map((x: any) => "- match " + x.match_id + " v" + x.version + ": " + x.status + " - " + x.explanation + " (evidence " + x.source_document_id + ", " + x.source_reference + ")"),
      "",
      "## Evidenced clock reconciliation decisions",
      ...(clockDecisions.data ?? []).map((x: any) => "- " + x.physical_reference + " / " + x.kind + " v" + x.version + ": selected " + x.selected_clock_id + "; considered " + x.considered_clock_ids.join(", ") + " - " + x.explanation + " (evidence " + x.source_document_id + ", " + x.source_reference + ")"),
      "",
      "## Required evidence and gaps (history, not proof of non-occurrence)",
      ...(gaps.data ?? []).map((x: any) => "- " + x.physical_reference + " / " + x.required_event + " v" + x.version + ": " + x.status + " - " + x.explanation),
      "",

      "## Contradictions",
      ...(contradictions.data ?? []).map((x: any) => "- " + x.title + ": " + x.description),
      "",
      "## Financial calculations",
      ...(calculations.data ?? []).map((x: any) => "- " + x.calculation_type + " " + (x.currency ?? "") + ": calculated=" + (x.calculated_amount_minor ?? "—") + " minor, charged=" + (x.charged_amount_minor ?? "—") + " minor, variance=" + (x.variance_minor ?? "—")),
      "",
      "## Limitations",
      "- AIS can contain gaps, spoofing or stale identity data.",
      "- Satellite scene availability is not the same as cargo-level proof.",
      "- Weather provides context and does not establish responsibility by itself.",
      "- Human review is required for disputed claims and external action.",
    ].join("\n");

    return { pack, payload, hash, summary };
  });

export const approveEvidencePack = createServerFn({ method: "POST" })
  .validator(z.object({ caseId: z.string().uuid(), packId: z.string().uuid() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    if (!["admin", "investigator"].includes(context.role)) throw new Error("Investigator access required");
    const { data: flagged, error: contradictionError } = await context.supabase
      .from("contradictions")
      .select("id")
      .eq("case_id", data.caseId)
      .eq("status", "FLAGGED")
      .limit(1);
    if (contradictionError) throw contradictionError;
    if (flagged?.length) throw new Error("Resolve the flagged contradictions before generating an evidence pack.");
    await assertClockGate(context.supabase, data.caseId);

    const { data: packResult, error } = await context.supabase.rpc("approve_evidence_pack_atomic", {
      _case_id: data.caseId,
      _pack_id: data.packId,
    });
    if (error) throw error;
    const pack = Array.isArray(packResult) ? packResult[0] : packResult;
    if (!pack?.id) throw new Error("Atomic evidence-pack approval returned no pack.");

    return pack;
  });

