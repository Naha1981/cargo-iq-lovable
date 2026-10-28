// Minimal text-only PDF writer (Helvetica, WinAnsi, A4). Used for the 2-page evidence pack.
const W = 595;
const H = 842;
const M = 48;
const esc = (s: string) =>
  s
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

export interface PdfLine {
  text: string;
  size?: number;
  bold?: boolean;
}

export function wrapText(text: string, size: number, maxChars?: number): string[] {
  const max = maxChars ?? Math.floor((W - 2 * M) / (size * 0.55));
  const out: string[] = [];
  let cur = "";
  for (const w of text.split(/\s+/)) {
    if ((cur + " " + w).trim().length > max) {
      if (cur) out.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}

// Lays lines top to bottom. Returns pages. Throws if more than maxPages are needed.
export function layout(lines: PdfLine[], maxPages: number): PdfLine[][] {
  const pages: PdfLine[][] = [[]];
  let y = H - M;
  for (const l of lines) {
    const size = l.size ?? 10;
    const lh = size * 1.35;
    if (y - lh < M) {
      pages.push([]);
      y = H - M;
    }
    pages[pages.length - 1].push(l);
    y -= lh;
  }
  if (pages.length > maxPages) throw new Error("PACK_TOO_LONG: needs " + pages.length + " pages");
  return pages;
}

export function buildPdf(pages: PdfLine[][], title: string): Uint8Array {
  const objs: string[] = [];
  const add = (s: string) => objs.push(s) && objs.length;
  const cat = add("");
  const root = add("");
  const f1 = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  );
  const f2 = add(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  );
  const kids: number[] = [];
  for (const pg of pages) {
    let y = H - M;
    let c = "";
    for (const l of pg) {
      const size = l.size ?? 10;
      y -= size * 1.35;
      c += `BT /${l.bold ? "F2" : "F1"} ${size} Tf ${M} ${y.toFixed(1)} Td (${esc(l.text)}) Tj ET\n`;
    }
    const content = add(`<< /Length ${c.length} >>\nstream\n${c}endstream`);
    const page = add(
      `<< /Type /Page /Parent ${root} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`,
    );
    kids.push(page);
  }
  const info = add(`<< /Title (${esc(title)}) /Producer (CargoIQ) >>`);
  objs[cat - 1] = `<< /Type /Catalog /Pages ${root} 0 R >>`;
  objs[root - 1] =
    `<< /Type /Pages /Kids [${kids.map((k) => k + " 0 R").join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R /Info ${info} 0 R >>\nstartxref\n${x}\n%%EOF`;
  return new TextEncoder().encode(out);
}
