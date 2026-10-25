import { z } from "zod";
import { countRecordInput } from "./count-ledger";
import { appointmentLifecycleInput } from "./appointment-lifecycle";
export const importInput = z.object({
  caseId: z.string().uuid(),
  sourceDocumentId: z.string().uuid(),
  sourceParty: z.string().trim().min(2).max(200),
  dataset: z.enum(["COUNTS", "APPOINTMENTS"]),
  authorizationBasis: z.string().trim().min(20).max(4000),
  exportedAt: z.string().datetime({ offset: true }),
  rawCsv: z.string().min(20).max(300000),
  confirmed: z.literal(true),
});
export type ImportInput = z.infer<typeof importInput>;
export const countHeaders = [
  "physicalReference",
  "metric",
  "basis",
  "quantity",
  "occurredAt",
  "containers20",
  "containers40",
  "gateKind",
  "sourceReference",
  "limitations",
];
export const appointmentHeaders = [
  "appointmentReference",
  "physicalReference",
  "recordType",
  "issuer",
  "startAt",
  "endAt",
  "occurredAt",
  "claimTarget",
  "outcome",
  "explanation",
  "termsReference",
  "sourceReference",
];
/** RFC4180-style quoted fields; no formulas evaluated and no heuristic schema inference. */
export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += ch;
    } else if (ch === '"') {
      if (field || closed) throw new Error("Malformed CSV quoting");
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
      closed = false;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
      field = "";
      closed = false;
    } else {
      if (closed) throw new Error("Unexpected content after quoted field");
      field += ch;
    }
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  row.push(field);
  if (row.some((x) => x !== "")) rows.push(row);
  if (rows.length > 501) throw new Error("Maximum 500 source rows per import");
  return rows;
}
export function previewImport(value: ImportInput) {
  const d = importInput.parse(value),
    rows = parseCsv(d.rawCsv),
    expected = d.dataset === "COUNTS" ? countHeaders : appointmentHeaders;
  const [headers, ...body] = rows;
  if (!headers || headers.length !== expected.length || headers.some((h, i) => h !== expected[i]))
    throw new Error("Exact CSV headers required: " + expected.join(","));
  if (!body.length) throw new Error("No source rows");
  const seen = new Set<string>();
  return body.map((cells, i) => {
    if (cells.length !== headers.length)
      throw new Error(`CSV row ${i + 2}: expected ${headers.length} cells`);
    const r = Object.fromEntries(headers.map((h, j) => [h, cells[j]]));
    const base = {
      ...r,
      caseId: d.caseId,
      party: d.sourceParty,
      sourceDocumentId: d.sourceDocumentId,
      supersedesId: null,
    };
    let result;
    try {
      result =
        d.dataset === "COUNTS"
          ? countRecordInput.parse({
              ...base,
              quantity: r.quantity.trim() === "" ? NaN : Number(r.quantity),
              containers20: r.containers20 === "" ? null : Number(r.containers20),
              containers40: r.containers40 === "" ? null : Number(r.containers40),
            })
          : appointmentLifecycleInput.parse({
              ...base,
              startAt: r.startAt || null,
              endAt: r.endAt || null,
            });
    } catch (e) {
      throw new Error(
        `CSV row ${i + 2}: ${e instanceof z.ZodError ? e.issues.map((x) => x.path.join(".") + ": " + x.message).join("; ") : String(e)}`,
      );
    }
    const key =
      d.dataset === "COUNTS"
        ? [r.physicalReference, r.metric, r.gateKind].join(":")
        : [r.appointmentReference, r.physicalReference, r.recordType, r.occurredAt].join(":");
    if (seen.has(key))
      throw new Error(`CSV row ${i + 2}: duplicate source identity; reconcile before importing`);
    seen.add(key);
    return result;
  });
}
