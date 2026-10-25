import { z } from "zod";

export const CCTV_EVENT_TYPES = [
  "VEHICLE_DETECTED",
  "VEHICLE_ENTERED_ZONE",
  "VEHICLE_EXITED_ZONE",
  "VEHICLE_STOPPED",
  "VEHICLE_MOVED",
  "VEHICLE_PRESENT",
  "ZONE_OCCUPIED",
  "ZONE_CLEARED",
  "QUEUE_DETECTED",
  "CAMERA_ONLINE",
  "CAMERA_OFFLINE",
] as const;

export const cctvIngestSchema = z
  .object({
    event_id: z.string().min(1).max(255).optional(),
    camera: z.object({
      provider_id: z.string().min(1).max(120),
      name: z.string().min(1).max(255).optional(),
      manufacturer: z.string().max(120).optional(),
      stream_type: z.string().max(40).optional(),
      installation_location: z.string().max(255).optional(),
      timezone: z.string().max(80).optional(),
      latitude: z.number().finite().optional(),
      longitude: z.number().finite().optional(),
    }),
    zone: z
      .object({
        provider_id: z.string().max(120).optional(),
        code: z.string().min(1).max(120),
        type: z.string().min(1).max(80).default("CUSTOM"),
        semantic_purpose: z.string().max(255).optional(),
        polygon: z.array(z.tuple([z.number().finite(), z.number().finite()])).optional(),
      })
      .optional(),
    event_type: z.enum(CCTV_EVENT_TYPES),
    detected_class: z.string().max(80).optional(),
    observed_at: z.string().datetime({ offset: true }),
    source_observed_at: z.string().datetime({ offset: true }).optional(),
    timezone: z.string().max(80).optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    model: z
      .object({
        name: z.string().max(120).optional(),
        version: z.string().max(120).optional(),
      })
      .optional(),
    processing_version: z.string().max(160).optional(),
    roi: z.record(z.string(), z.unknown()).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
    evidence: z
      .object({
        media_type: z.string().min(1).max(120),
        file_name: z.string().min(1).max(255),
        captured_at: z.string().datetime({ offset: true }).optional(),
        base64: z.string().min(1).max(8_000_000),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
  })
  .strict();

export type CctvIngestEvent = z.infer<typeof cctvIngestSchema>;

export function defaultCctvLimitation(): string {
  return "Computer-vision observation generated from a configured CCTV source. Vehicle identity is not independently established; detection may be affected by camera angle, lighting, weather, occlusion and image quality.";
}

export function cctvEventTitle(eventType: string, zoneCode?: string | null): string {
  const zone = zoneCode ? " " + zoneCode : "";
  switch (eventType) {
    case "VEHICLE_ENTERED_ZONE":
      return "CCTV: vehicle entered" + zone;
    case "VEHICLE_EXITED_ZONE":
      return "CCTV: vehicle exited" + zone;
    case "VEHICLE_STOPPED":
      return "CCTV: vehicle stopped" + zone;
    case "VEHICLE_PRESENT":
      return "CCTV: vehicle present" + zone;
    case "ZONE_OCCUPIED":
      return "CCTV: zone occupied" + zone;
    case "ZONE_CLEARED":
      return "CCTV: zone cleared" + zone;
    case "QUEUE_DETECTED":
      return "CCTV: queue detected" + zone;
    case "CAMERA_ONLINE":
      return "CCTV: camera online" + zone;
    case "CAMERA_OFFLINE":
      return "CCTV: camera offline" + zone;
    default:
      return "CCTV: " + eventType.replaceAll("_", " ").toLowerCase() + zone;
  }
}
