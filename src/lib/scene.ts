// 3D Scene Intelligence: scene asset register + conversion job model.
// Honesty rules: a scene is "ready" only when a real tileset URL is verified
// loadable; conversion jobs report converter_unavailable when no converter is
// installed - a queued/converting job never fabricates output.
import { z } from "zod";

export const SCENE_SOURCE_TYPES = ["ply", "3dtiles", "laz", "other"] as const;
export type SceneSourceType = (typeof SCENE_SOURCE_TYPES)[number];

export const SCENE_STATUSES = ["registered", "queued", "converting", "ready", "failed"] as const;
export type SceneStatus = (typeof SCENE_STATUSES)[number];

export const sceneAssetInput = z.object({
  caseId: z.string().uuid().optional(),
  name: z.string().min(1).max(300),
  sourceType: z.enum(SCENE_SOURCE_TYPES),
  sourceRef: z.string().max(1000).optional(), // original file/object reference
  acquiredAt: z.string().datetime().optional(), // when the underlying data was captured
  tilesetUrl: z.string().url().max(2000).optional(), // present only when a real tileset exists
  eventIds: z.array(z.string().uuid()).max(100).default([]),
  documentIds: z.array(z.string().uuid()).max(100).default([]),
  provenance: z
    .object({
      provider: z.string().max(300).optional(),
      method: z.string().max(300).optional(),
      licence: z.string().max(300).optional(),
      limitations: z.string().max(2000).optional(),
    })
    .partial()
    .default({}),
});
export type SceneAssetInput = z.infer<typeof sceneAssetInput>;

export const CONVERTER_AVAILABLE = false as const; // no converter installed; gated separately

export type ConversionJobResult =
  { outcome: "converter_unavailable"; reason: string } | { outcome: "started"; jobId: string };

// The only honest path today: no converter is installed or approved, so every
// conversion request reports unavailability rather than pretending to convert.
export function requestConversion(assetId: string): ConversionJobResult {
  if (!CONVERTER_AVAILABLE) {
    return {
      outcome: "converter_unavailable",
      reason:
        "No PLY/LAZ converter is installed or approved for this environment. " +
        "Asset " +
        assetId +
        " stays registered; provide a 3D Tiles tileset URL to view, " +
        "or approve a converter toolchain first.",
    };
  }
  return { outcome: "started", jobId: assetId };
}

// A scene is viewable only with a concrete tileset URL.
export function isViewable(a: { status: SceneStatus; tilesetUrl?: string | null }): boolean {
  return (a.status === "ready" || a.status === "registered") && !!a.tilesetUrl;
}

// Validate a tileset URL candidate without fetching it: https only, no
// credentials-in-URL (leak guard), must look like a tileset JSON.
export function validateTilesetUrl(url: string): { ok: true } | { ok: false; reason: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: "not a valid URL" };
  }
  if (u.protocol !== "https:") return { ok: false, reason: "https required" };
  if (u.username || u.password) return { ok: false, reason: "credentials in URL are not allowed" };
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.includes(":") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host)
  )
    return {
      ok: false,
      reason: "public hostname required; local/private IP targets are not permitted",
    };
  if (!u.pathname.endsWith(".json")) return { ok: false, reason: "expected a tileset .json URL" };
  return { ok: true };
}

export const SCENE_TRANSITIONS: Record<SceneStatus, SceneStatus[]> = {
  registered: ["queued", "ready", "failed"], // ready only via direct tileset registration
  queued: ["converting", "failed"],
  converting: ["ready", "failed"],
  ready: [],
  failed: ["queued"],
};

export function assertSceneTransition(from: SceneStatus, to: SceneStatus): void {
  if (!SCENE_TRANSITIONS[from].includes(to)) {
    throw new Error("INVALID_SCENE_TRANSITION: " + from + " -> " + to);
  }
}

export function compareSceneCaptures<
  A extends { id: string; name: string; acquired_at: string | null },
  B extends { id: string; name: string; acquired_at: string | null },
>(a: A, b: B) {
  if (a.id === b.id) throw new Error("SELECT_TWO_DISTINCT_SCENES");
  const at = a.acquired_at ? Date.parse(a.acquired_at) : NaN,
    bt = b.acquired_at ? Date.parse(b.acquired_at) : NaN;
  if (!Number.isFinite(at) || !Number.isFinite(bt))
    return {
      ordered: [a, b],
      gapHours: null,
      label: "Capture time missing or invalid - before/after order unverified",
    };
  return {
    ordered: at <= bt ? [a, b] : [b, a],
    gapHours: Math.round(Math.abs(at - bt) / 360000) / 10,
    label:
      at === bt
        ? "Same recorded capture time - no before/after interval"
        : "Ordered by recorded capture time only",
  };
}
