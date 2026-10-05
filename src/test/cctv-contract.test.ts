import { describe, expect, it } from "vitest";
import { cctvEventTitle, cctvIngestSchema, defaultCctvLimitation } from "@/lib/cctv-contract";

describe("CCTV evidence contract", () => {
  it("accepts a normalized event", () => {
    const result = cctvIngestSchema.safeParse({
      event_id: "cam-1-zone-1-123",
      camera: { provider_id: "1", name: "Gate 04", timezone: "Africa/Johannesburg" },
      zone: { code: "GATE-04", type: "GATE_ENTRY" },
      event_type: "ZONE_OCCUPIED",
      detected_class: "vehicle",
      observed_at: "2026-10-05T14:03:12+02:00",
      confidence: 0.91,
      model: { name: "vulturevision", version: "community" },
      processing_version: "cargoiq-lotvulture-adapter/1.0.0",
      payload: { scan_id: 42 },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid confidence", () => {
    const result = cctvIngestSchema.safeParse({
      camera: { provider_id: "1" },
      event_type: "ZONE_OCCUPIED",
      observed_at: "2026-10-05T14:03:12+02:00",
      confidence: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("keeps the truth model source-attributed", () => {
    expect(cctvEventTitle("VEHICLE_ENTERED_ZONE", "GATE-04")).toBe("CCTV: vehicle entered GATE-04");
    expect(defaultCctvLimitation()).toContain("Vehicle identity is not independently established");
  });
});
