import { type Rate, validateRate, overlapping } from "./quote-engine";
export const RATE_CSV_HEADER =
  "version,origin,destination,equipment,min_kg,max_kg,amount_minor,currency,vat_treatment,vat_bps,valid_from,valid_to,validity_hours,terms,exclusions,source_reference,disclosure_approved";
/** RFC4180-style quoting, strict columns, bounded text. No eval or spreadsheet formula handling. */
export function csvRows(text: string): string[][] {
  if (text.length > 200000) throw new Error("CSV_TOO_LARGE");
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  text = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
      continue;
    }
    if (c === '"') {
      if (field || closed) throw new Error("CSV_BAD_QUOTE");
      quoted = true;
      continue;
    }
    if (c === "," || c === "\n") {
      row.push(field);
      field = "";
      closed = false;
      if (c === "\n") {
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
      continue;
    }
    if (closed) throw new Error("CSV_TEXT_AFTER_QUOTE");
    field += c;
  }
  if (quoted) throw new Error("CSV_UNCLOSED_QUOTE");
  if (field || row.length) {
    row.push(field);
    if (row.some(Boolean)) rows.push(row);
  }
  if (rows.length > 501) throw new Error("CSV_MAX_500_RATES");
  return rows;
}
export function parseRateCsv(text: string): Rate[] {
  const rows = csvRows(text);
  if (rows.shift()?.join(",") !== RATE_CSV_HEADER) throw new Error("CSV_HEADER_MISMATCH");
  if (!rows.length) throw new Error("CSV_EMPTY");
  const rates = rows.map((c, i) => {
    if (c.length !== 17) throw new Error(`CSV_COLUMNS_ROW_${i + 2}`);
    const integer = (s: string) => (/^\d+$/.test(s) ? Number(s) : NaN);
    const r: Rate = {
      id: `import-row-${i + 2}`,
      version: c[0],
      origin: c[1] as Rate["origin"],
      destination: c[2] as Rate["destination"],
      equipment: c[3] as "TAUTLINER",
      minKg: integer(c[4]),
      maxKg: integer(c[5]),
      amountMinor: integer(c[6]),
      currency: c[7] as "ZAR",
      vatTreatment: c[8] as Rate["vatTreatment"],
      vatBps: integer(c[9]),
      validFrom: c[10],
      validTo: c[11],
      validityHours: integer(c[12]),
      terms: c[13],
      exclusions: c[14],
      sourceReference: c[15],
      disclosureApproved: c[16] === "true",
    };
    const errors = validateRate(r);
    if (errors.length) throw new Error(`CSV_ROW_${i + 2}: ${errors.join("; ")}`);
    return r;
  });
  for (let i = 0; i < rates.length; i++)
    for (let j = 0; j < i; j++)
      if (overlapping(rates[i], rates[j])) throw new Error(`CSV_OVERLAP_ROWS_${j + 2}_${i + 2}`);
  return rates;
}
