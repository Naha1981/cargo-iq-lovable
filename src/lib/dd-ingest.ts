// Evidence ingestion for the D&D workflow: turns pasted or uploaded text (invoice text,
// CSV exports, forwarded notice emails) into proposed case facts with provenance.
// Everything extracted is a PROPOSAL the user confirms; unreadable fields stay empty.
import type { DelayCause, DocType } from "./dd-analysis";

export interface ProposedInvoice {
  invoiceNo: string | null;
  containerNos: string[];
  currency: string | null;
  lines: { description: string; quantity: number; unitPrice: number; amount: number }[];
  total: number | null;
  dates: string[];
  chargeType: "demurrage" | "detention" | "storage" | "other";
  days: number | null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// ISO 6346 check digit: accept only container numbers that validate.
export function isValidContainerNo(raw: string): boolean {
  const s = raw.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z]{3}[UJZ]\d{7}$/.test(s)) return false;
  const vals: Record<string, number> = {};
  let v = 10;
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    if (v % 11 === 0) v++;
    vals[ch] = v++;
  }
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const n = i < 4 ? vals[s[i]] : Number(s[i]);
    sum += n * 2 ** i;
  }
  return (sum % 11) % 10 === Number(s[10]);
}

export function findContainerNos(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b([A-Z]{3}[UJZ])[\s-]?(\d{6})[\s-]?(\d)\b/g)) {
    const c = m[1] + m[2] + m[3];
    if (isValidContainerNo(c)) out.add(c);
  }
  return [...out];
}

// Dates: ISO, "4 March 2026", "04/03/2026" (day first, South African convention).
export function findDates(text: string): string[] {
  const out: string[] = [];
  const push = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d)
      out.push(dt.toISOString().slice(0, 10));
  };
  const re =
    /\b(\d{4})-(\d{2})-(\d{2})\b|\b(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b|\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g;
  for (const m of text.matchAll(re)) {
    if (m[1]) push(+m[1], +m[2], +m[3]);
    else if (m[4]) {
      const mi = MONTHS.indexOf(m[5].slice(0, 3).toLowerCase());
      if (mi >= 0) push(+m[6], mi + 1, +m[4]);
    } else push(+m[9], +m[8], +m[7]);
  }
  return out;
}

const num = (s: string) => Number(s.replace(/[,\s](?=\d{3}\b)/g, "").replace(",", "."));
const AMT = String.raw`(?:R|ZAR|USD|\$)?\s?(\d{1,3}(?:[ ,]\d{3})*(?:\.\d{2})|\d+(?:\.\d{2})?)`;

export function parseInvoiceText(text: string): ProposedInvoice {
  const invoiceNo =
    /invoice\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{3,})/i.exec(text)?.[1] ?? null;
  const currency = /\b(ZAR|USD|EUR)\b/.exec(text)?.[1] ?? (/\bR\s?\d/.test(text) ? "ZAR" : null);
  const lines: ProposedInvoice["lines"] = [];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    // "Demurrage 5 days x 500.00 = 2500.00" or "Description | qty | rate | amount"
    const m = new RegExp(
      String.raw`^(.*?[A-Za-z].*?)\s*[|\t ]\s*(\d+(?:\.\d+)?)\s*(?:days?\s*)?[xX*|\t ]\s*${AMT}\s*(?:=|[|\t ])\s*${AMT}$`,
    ).exec(l);
    if (m) {
      const q = Number(m[2]),
        u = num(m[3]),
        a = num(m[4]);
      if (Math.abs(q * u - a) < 0.02)
        lines.push({
          description: m[1].replace(/[|:\-\s]+$/, "").trim(),
          quantity: q,
          unitPrice: u,
          amount: a,
        });
    }
  }
  const total = (() => {
    const m = new RegExp(String.raw`(?:total(?:\s+due)?|amount\s+due)\s*[:|]?\s*${AMT}`, "i").exec(
      text,
    );
    return m ? num(m[1]) : null;
  })();
  const lower = text.toLowerCase();
  const chargeType =
    lower.includes("detention") && !lower.includes("demurrage")
      ? "detention"
      : lower.includes("storage") && !lower.includes("demurrage")
        ? "storage"
        : lower.includes("demurrage")
          ? "demurrage"
          : "other";
  const days =
    lines.length && lines.every((l) => /demurrage|detention|storage/i.test(l.description))
      ? lines.reduce((s, l) => s + l.quantity, 0)
      : null;
  return {
    invoiceNo,
    containerNos: findContainerNos(text),
    currency,
    lines,
    total,
    dates: findDates(text),
    chargeType,
    days,
  };
}

// Simple CSV (comma or semicolon, quoted fields). Header names matched loosely.
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  const delim = (text.split("\n")[0] ?? "").includes(";") ? ";" : ",";
  let cur: string[] = [],
    f = "",
    q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) {
      cur.push(f);
      f = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      cur.push(f);
      f = "";
      if (cur.some((c) => c.trim())) rows.push(cur);
      cur = [];
    } else f += ch;
  }
  cur.push(f);
  if (cur.some((c) => c.trim())) rows.push(cur);
  const head = (rows.shift() ?? []).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

export interface ProposedRelease {
  containerNo: string;
  gateOutDate: string | null;
  releaseDate: string | null;
  raw: Record<string, string>;
}
export function parseTerminalReleaseCsv(text: string): ProposedRelease[] {
  return parseCsv(text).flatMap((r) => {
    const cn = findContainerNos(Object.values(r).join(" "))[0];
    if (!cn) return [];
    const pick = (re: RegExp) => {
      const k = Object.keys(r).find((x) => re.test(x));
      return k ? (findDates(r[k])[0] ?? null) : null;
    };
    return [
      {
        containerNo: cn,
        gateOutDate: pick(/gate.?out|collect|out/),
        releaseDate: pick(/releas|clear/),
        raw: r,
      },
    ];
  });
}

export interface ProposedNotice {
  from: string | null;
  subject: string | null;
  sentOn: string | null;
  containerNos: string[];
  dates: string[];
  proposedCause: DelayCause | null;
  cues: string[];
  delayWindow: { from: string; to: string } | null;
}
const CUES: [RegExp, DelayCause][] = [
  [
    /(system|gate|crane|equipment|yard|power)\s+(outage|failure|breakdown|down|closure|closed)|terminal\s+(delay|congestion|closure|strike)|port\s+(congestion|strike)|transnet/i,
    "terminal",
  ],
  [
    /vessel\s+(delay|omitted|rolled)|carrier\s+(error|delay)|late\s+(release|delivery order)|delivery order\s+(delay|not issued)/i,
    "carrier",
  ],
  [/customs?\s+(hold|inspection|verification|query)|sars\s+(hold|inspection)/i, "customs"],
  [/weather|storm|wind\s+(delay|closure)|force majeure/i, "weather"],
];
export function parseNoticeEmail(text: string): ProposedNotice {
  const hdr = (n: string) =>
    new RegExp("^" + n + ":\\s*(.+)$", "im").exec(text)?.[1]?.trim() ?? null;
  const dates = findDates(text);
  const cues: string[] = [];
  let cause: DelayCause | null = null;
  for (const [re, c] of CUES) {
    const m = re.exec(text);
    if (m) {
      cues.push(m[0]);
      cause = cause ?? c;
    }
  }
  const sentOn = (() => {
    const d = hdr("date");
    return d ? (findDates(d)[0] ?? null) : null;
  })();
  const body = dates.filter((d) => d !== sentOn);
  const sorted = [...new Set(body.length ? body : dates)].sort();
  return {
    from: hdr("from"),
    subject: hdr("subject"),
    sentOn,
    containerNos: findContainerNos(text),
    dates,
    proposedCause: cause,
    cues,
    delayWindow: cause && sorted.length ? { from: sorted[0], to: sorted[sorted.length - 1] } : null,
  };
}

export function guessDocType(name: string, text = ""): DocType {
  const s = (name + " " + text.slice(0, 600)).toLowerCase();
  if (/bill of lading|\bb\/?l\b|bol/.test(s)) return "bill_of_lading";
  if (/terminal.*(notice|advisory|circular)|transnet.*(notice|advisory)/.test(s))
    return "terminal_notice";
  if (/release|gate.?out|collection/.test(s)) return "terminal_release";
  if (/free.?time|tariff|rate card/.test(s)) return "tariff_or_free_time";
  if (/customs/.test(s)) return "customs_release";
  if (/customer.*invoice|credit note/.test(s)) return "customer_invoice";
  if (/notice|advisory|circular/.test(s)) return "carrier_notice";
  if (/invoice|demurrage|detention/.test(s)) return "carrier_invoice";
  return "other";
}
