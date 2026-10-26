import { describe, it, expect } from "vitest";
import { inspectPlyHeader, MAX_SCENE_PLY_BYTES } from "./ply-validation";
const fields = [
  "x",
  "y",
  "z",
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
];
const header = (props = fields, format = "binary_little_endian", count = 2) =>
  new TextEncoder().encode(
    "ply\nformat " +
      format +
      " 1.0\nelement vertex " +
      count +
      "\n" +
      props.map((p) => "property float " + p).join("\n") +
      "\nend_header\n",
  );
describe("bounded PLY inspection", () => {
  it("recognises GraphDECO header but retains explicit integrity/placement limitations", () => {
    const h = header();
    const r = inspectPlyHeader(h, h.length + fields.length * 4 * 2);
    expect(r.variant).toBe("graphdeco_gaussian");
    expect(r.warnings.join(" ")).toContain("not verified");
  });
  it("generic PLY never becomes Gaussian just because extension is ply", () => {
    const h = header(["x", "y", "z"]);
    expect(inspectPlyHeader(h, h.length + 24).variant).toBe("generic_point_cloud");
  });
  it("refuses truncated binary body", () => {
    const h = header();
    expect(() => inspectPlyHeader(h, h.length + 1)).toThrow("TRUNCATED");
  });
  it("refuses oversize/headerless/empty input", () => {
    expect(() => inspectPlyHeader(header(), MAX_SCENE_PLY_BYTES + 1)).toThrow("SIZE_LIMIT");
    expect(() => inspectPlyHeader(new TextEncoder().encode("not ply"), 100)).toThrow("HEADER");
    expect(() => inspectPlyHeader(header(), 0)).toThrow("SIZE_LIMIT");
  });
  it("refuses duplicate properties and missing xyz", () => {
    expect(() => inspectPlyHeader(header(["x", "y", "z", "x"]), 9999)).toThrow(
      "DUPLICATE_PROPERTY",
    );
    expect(() => inspectPlyHeader(header(["x", "y"]), 9999)).toThrow("XYZ_REQUIRED");
  });
});
