export interface NormalizedAis {
  mmsi: string;
  vesselName: string | null;
  latitude: number;
  longitude: number;
  sog: number | null;
  cog: number | null;
  navigationalStatus: string | null;
  observedAt: string;
  source: string;
}
const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const rec = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

export function normalizeAisMessage(payload: Record<string, unknown>): NormalizedAis | null {
  const metadata = rec(payload.MetaData ?? payload.metadata ?? payload);
  const message = rec(payload.Message ?? payload.message);
  const position = rec(
    message.PositionReport ?? message.positionReport ?? message.Position ?? metadata,
  );
  const lat = num(position.Latitude ?? position.latitude ?? metadata.Latitude);
  const lon = num(position.Longitude ?? position.longitude ?? metadata.Longitude);
  const mmsi = String(metadata.MMSI ?? metadata.mmsi ?? message.MMSI ?? "").trim();
  if (!mmsi || lat == null || lon == null) return null;
  return {
    mmsi,
    vesselName: metadata.ShipName ? String(metadata.ShipName).trim() : null,
    latitude: lat,
    longitude: lon,
    sog: num(position.Sog ?? position.SOG ?? position.sog),
    cog: num(position.Cog ?? position.COG ?? position.cog),
    navigationalStatus:
      position.NavigationalStatus != null ? String(position.NavigationalStatus) : null,
    observedAt: new Date(
      typeof payload.timestamp === "string" || typeof payload.timestamp === "number"
        ? payload.timestamp
        : Date.now(),
    ).toISOString(),
    source: "AISStream",
  };
}
export function buildAisBoundingBox(
  center: [number, number],
  radiusKm = 25,
): [number, number, number, number] {
  const [lat, lon] = center;
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  return [lon - lonDelta, lat - latDelta, lon + lonDelta, lat + latDelta];
}
export async function fetchAisSnapshot(options: {
  vesselName?: string;
  bbox: [number, number, number, number];
  timeoutMs?: number;
}) {
  const apiKey = process.env.AISSTREAM_API_KEY;
  const httpEndpoint = process.env.AIS_PUBLIC_HTTP_URL;
  if (httpEndpoint) {
    const response = await fetch(httpEndpoint, {
      headers: apiKey ? { Authorization: "Bearer " + apiKey } : {},
    });
    if (response.ok) {
      const body = await response.json();
      const rows = Array.isArray(body) ? body : (body?.data ?? []);
      return rows.map(normalizeAisMessage).filter(Boolean) as NormalizedAis[];
    }
  }
  if (!apiKey || typeof WebSocket === "undefined") return [];
  const [west, south, east, north] = options.bbox;
  const wanted = options.vesselName?.trim().toLowerCase();
  const timeoutMs = options.timeoutMs ?? 7000;
  const rows: NormalizedAis[] = [];
  await new Promise<void>((resolve) => {
    const socket = new WebSocket("wss://stream.aisstream.io/v0/stream");
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // best-effort close; socket may already be closed
      }
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    socket.addEventListener("open", () =>
      socket.send(
        JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: [
            [
              [south, west],
              [north, east],
            ],
          ],
          FilterMessageTypes: ["PositionReport", "ShipStaticData", "StaticDataReport"],
        }),
      ),
    );
    socket.addEventListener("message", (event) => {
      const row = normalizeAisMessage(JSON.parse(String(event.data)));
      if (!row) return;
      if (wanted && !(row.vesselName ?? "").toLowerCase().includes(wanted)) return;
      rows.push(row);
      if (rows.length >= 100) finish();
    });
    socket.addEventListener("error", finish);
    socket.addEventListener("close", finish);
  });
  return rows;
}
