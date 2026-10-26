// Bounded header inspection, not a converter. Never claims a compatible renderer.
export const MAX_SCENE_PLY_BYTES = 20 * 1024 * 1024;
const widths: Record<string, number> = {
  char: 1,
  uchar: 1,
  int8: 1,
  uint8: 1,
  short: 2,
  ushort: 2,
  int16: 2,
  uint16: 2,
  int: 4,
  uint: 4,
  int32: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
};
export interface PlyInspection {
  format: string;
  vertices: number;
  properties: string[];
  variant: "graphdeco_gaussian" | "generic_point_cloud";
  warnings: string[];
  headerBytes: number;
}
export function inspectPlyHeader(header: Uint8Array, totalBytes: number): PlyInspection {
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 1 || totalBytes > MAX_SCENE_PLY_BYTES)
    throw new Error("PLY_SIZE_LIMIT: 1 byte to 20 MiB only");
  if (header.byteLength > 65536) throw new Error("PLY_HEADER_LIMIT");
  const text = new TextDecoder("ascii").decode(header);
  const end = /end_header\r?\n/.exec(text);
  if (!end) throw new Error("PLY_HEADER_MISSING_OR_TOO_LARGE");
  const headerBytes = end.index + end[0].length;
  const lines = text.slice(0, headerBytes).split(/\r?\n/);
  if (lines[0] !== "ply") throw new Error("NOT_A_PLY_FILE");
  const formatLine = lines.find((l) => l.startsWith("format "))?.split(/\s+/);
  const format = formatLine?.[1];
  if (
    !format ||
    !["ascii", "binary_little_endian", "binary_big_endian"].includes(format) ||
    formatLine?.[2] !== "1.0"
  )
    throw new Error("UNSUPPORTED_PLY_FORMAT");
  let vertexCount: number | null = null,
    active = "",
    stride = 0;
  const properties: string[] = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === "element") {
      active = parts[1];
      const count = Number(parts[2]);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error("INVALID_ELEMENT_COUNT");
      if (active === "vertex") {
        if (vertexCount !== null) throw new Error("DUPLICATE_VERTEX_ELEMENT");
        vertexCount = count;
      } else if (count > 0)
        throw new Error(
          "UNSUPPORTED_NON_VERTEX_ELEMENTS: register a point/splat dataset, not a mesh",
        );
    }
    if (parts[0] === "property" && active === "vertex") {
      if (parts[1] === "list" || !widths[parts[1]]) throw new Error("UNSUPPORTED_VERTEX_PROPERTY");
      if (properties.includes(parts[2])) throw new Error("DUPLICATE_PROPERTY");
      properties.push(parts[2]);
      stride += widths[parts[1]];
    }
  }
  if (!vertexCount || vertexCount > 2_000_000) throw new Error("VERTEX_COUNT_LIMIT");
  if (!["x", "y", "z"].every((p) => properties.includes(p))) throw new Error("XYZ_REQUIRED");
  if (format !== "ascii" && totalBytes < headerBytes + stride * vertexCount)
    throw new Error("TRUNCATED_BINARY_PLY");
  if (totalBytes <= headerBytes) throw new Error("PLY_BODY_MISSING");
  const gaussian = [
    "opacity",
    "f_dc_0",
    "f_dc_1",
    "f_dc_2",
    "scale_0",
    "scale_1",
    "scale_2",
    "rot_0",
    "rot_1",
    "rot_2",
    "rot_3",
  ].every((p) => properties.includes(p));
  return {
    format,
    vertices: vertexCount,
    properties,
    headerBytes,
    variant: gaussian ? "graphdeco_gaussian" : "generic_point_cloud",
    warnings: [
      "Header inspection only. Vertex values, compression, coordinate system, renderer support and full integrity are not verified.",
      ...(format === "ascii" ? ["ASCII body row count and values are not validated."] : []),
      ...(!gaussian
        ? [
            "Not a recognised GraphDECO Gaussian-splat header. Do not submit to the Gaussian converter.",
          ]
        : []),
      "No geographic alignment inferred. File stays on this device; it has not been uploaded or converted.",
    ],
  };
}
