import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { tenantMiddleware } from "@/lib/auth-middleware";
import { sha256Hex, stableCanonical } from "@/lib/hash";
import { calculateDemurrage } from "@/lib/investigation-engine";
import { buildAisBoundingBox, fetchAisSnapshot } from "@/lib/adapters/ais-adapter";
import { querySentinelScenes } from "@/lib/adapters/satellite-adapter";
import { fetchPortConditions } from "@/lib/adapters/weather-port-adapter";
import { extractDocumentClaimsForPath } from "@/lib/extraction.functions";

const idInput = z.object({ caseId: z.string().uuid() });

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

  return (cases ?? []).map((c: any) => {
    const calc = latestCalc.get(c.id);
    const openContradictions = (contradictions ?? []).filter((x: any) => x.case_id === c.id && x.status === "FLAGGED").length;
    const charged = calc?.charged_amount_minor ? Number(calc.charged_amount_minor) / 100 : 0;
    const calculated = calc?.calculated_amount_minor ? Number(calc.calculated_amount_minor) / 100 : 0;
    return { ...c, currency: calc?.currency ?? "ZAR", exposure: charged, recovery: Math.max(0, charged - calculated), contradictions: openContradictions };
  });
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
  const [documents, claims, contradictions, timeline, observations, calcs, packs] = await Promise.all([
    db.from("documents").select("*").eq("case_id", data.caseId).order("uploaded_at", { ascending: false }),
    db.from("extracted_claims").select("*").eq("case_id", data.caseId).order("created_at", { ascending: true }),
    db.from("contradictions").select("*").eq("case_id", data.caseId).order("created_at", { ascending: false }),
    db.from("timeline_events").select("*").eq("case_id", data.caseId).order("timestamp", { ascending: true }),
    db.from("external_observations").select("*").eq("case_id", data.caseId).order("observed_at", { ascending: true }),
    db.from("financial_calculations").select("*").eq("case_id", data.caseId).order("created_at", { ascending: false }),
    db.from("evidence_packs").select("id,version,sha256_hash,status,approved_by,generated_at,pack_payload").eq("case_id", data.caseId).order("version", { ascending: false }),
  ]);
  for (const item of [documents, claims, contradictions, timeline, observations, calcs, packs]) if (item.error) throw item.error;
  return {
    tenantId: context.tenantId,
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
    sourceParty: z.string().optional(),
  }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    const expectedPrefix = context.tenantId + "/" + data.caseId + "/";
    if (!data.filePath.startsWith(expectedPrefix)) throw new Error("INVALID_STORAGE_PATH");

    const { data: blob, error: downloadError } = await context.supabase.storage.from("case-documents").download(data.filePath);
    if (downloadError || !blob) throw downloadError ?? new Error("DOCUMENT_DOWNLOAD_FAILED");

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
  .validator(z.object({ documentId: z.string().uuid(), caseId: z.string().uuid() }))
  .middleware([tenantMiddleware])
  .handler(({ data, context }) => extractDocumentClaimsForPath({
    ...data,
    tenantId: context.tenantId,
    supabase: context.supabase,
    userId: context.user.id,
  }));

export const reviewClaim = createServerFn({ method: "POST" })
  .validator(z.object({ claimId: z.string().uuid(), caseId: z.string().uuid(), decision: z.enum(["VERIFIED","DISPUTED"]) }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
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
  .validator(z.object({ contradictionId: z.string().uuid(), caseId: z.string().uuid() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.from("contradictions").update({
      status: "RESOLVED",
      resolved_by: context.user.id,
      resolved_at: new Date().toISOString(),
    }).eq("id", data.contradictionId).eq("case_id", data.caseId).select("*").single();
    if (error) throw error;
    return row;
  });

export const corroborateCase = createServerFn({ method: "POST" })
  .validator(z.object({ caseId: z.string().uuid(), start: z.string(), end: z.string() }))
  .middleware([tenantMiddleware])
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.from("cases").select("vessel_name,port_code").eq("id", data.caseId).single();
    if (error || !row) throw error ?? new Error("CASE_NOT_FOUND");

    const center: [number, number] = row.port_code === "ZADUR" || row.port_code === "DURBAN" ? [-29.8833, 31.05] : [-29.8833, 31.05];
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
    const db = context.supabase;
    const [c, docs, claims, contradictions, timeline, observations, calculations, existing] = await Promise.all([
      db.from("cases").select("*").eq("id", data.caseId).single(),
      db.from("documents").select("*").eq("case_id", data.caseId).order("uploaded_at", { ascending: true }),
      db.from("extracted_claims").select("*").eq("case_id", data.caseId).order("created_at", { ascending: true }),
      db.from("contradictions").select("*").eq("case_id", data.caseId).order("created_at", { ascending: true }),
      db.from("timeline_events").select("*").eq("case_id", data.caseId).order("timestamp", { ascending: true }),
      db.from("external_observations").select("*").eq("case_id", data.caseId).order("observed_at", { ascending: true }),
      db.from("financial_calculations").select("*").eq("case_id", data.caseId).order("created_at", { ascending: true }),
      db.from("evidence_packs").select("version,status").eq("case_id", data.caseId).order("version", { ascending: false }),
    ]);
    for (const x of [c, docs, claims, contradictions, timeline, observations, calculations, existing]) if (x.error) throw x.error;

    const unresolved = (contradictions.data ?? []).filter((x: any) => x.status === "FLAGGED").length;
    if (unresolved > 0) throw new Error("Resolve the flagged contradictions before generating an evidence pack.");

    const version = ((existing.data?.[0]?.version as number | undefined) ?? 0) + 1;
    const payload = {
      generatedAt: new Date().toISOString(),
      version,
      case: c.data,
      documents: docs.data ?? [],
      verifiedClaims: (claims.data ?? []).filter((x: any) => x.status === "VERIFIED"),
      claims: claims.data ?? [],
      contradictions: contradictions.data ?? [],
      timeline: timeline.data ?? [],
      externalObservations: observations.data ?? [],
      financialCalculations: calculations.data ?? [],
      approvals: [],
      truthRule: "Public and independent observations are corroboration unless the source directly proves the event. Inference remains inference until human review.",
    };
    const hash = await sha256Hex(stableCanonical(payload));

    if (existing.data?.[0]) {
      await db.from("evidence_packs").update({ status: "SUPERSEDED" }).eq("case_id", data.caseId).eq("status", "DRAFT");
    }

    const { data: pack, error } = await db.from("evidence_packs").insert({
      tenant_id: context.tenantId,
      case_id: data.caseId,
      version,
      pack_payload: payload,
      sha256_hash: hash,
      status: "DRAFT",
    }).select("*").single();
    if (error) throw error;

    await db.from("audit_log").insert({
      tenant_id: context.tenantId,
      case_id: data.caseId,
      actor_user_id: context.user.id,
      action: "EVIDENCE_PACK_GENERATED",
      entity_type: "evidence_pack",
      entity_id: pack.id,
      payload: { version, sha256_hash: hash },
    });

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
    const { data: flagged, error: contradictionError } = await context.supabase
      .from("contradictions")
      .select("id")
      .eq("case_id", data.caseId)
      .eq("status", "FLAGGED")
      .limit(1);
    if (contradictionError) throw contradictionError;
    if (flagged?.length) throw new Error("Resolve the flagged contradictions before generating an evidence pack.");

    const { data: pack, error } = await context.supabase.from("evidence_packs").update({
      status: "APPROVED",
      approved_by: context.user.id,
    }).eq("id", data.packId).eq("case_id", data.caseId).eq("status", "DRAFT").select("*").single();
    if (error) throw error;

    await context.supabase.from("cases").update({ status: "APPROVED" }).eq("id", data.caseId);
    await context.supabase.from("audit_log").insert({
      tenant_id: context.tenantId,
      case_id: data.caseId,
      actor_user_id: context.user.id,
      action: "EVIDENCE_PACK_APPROVED",
      entity_type: "evidence_pack",
      entity_id: data.packId,
      payload: {},
    });

    return pack;
  });

