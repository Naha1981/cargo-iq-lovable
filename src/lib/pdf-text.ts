import { plainTextClaims } from "./extraction-policy";
export async function readPdfLines(bytes: ArrayBuffer) {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes.slice(0)));
  try {
    if (pdf.numPages > 20) throw new Error("No-AI PDF text import accepts up to 20 pages. Split the file and try again.");
    const { text } = await extractText(pdf, { mergePages: false });
    plainTextClaims(text.join("\n"));
    const lines = text.flatMap((page, i) => page.split(/\r?\n/).map(line => ({ page_number: i + 1, text: line.trim() })).filter(line => line.text));
    if (!lines.length) throw new Error("This PDF has no readable text layer. It may be scanned or encrypted. Upload a TXT/CSV transcription or try AI again when available; your file is safe.");
    return lines;
  } finally { await pdf.destroy(); }
}

// Page-tagged text for AI chunking. No 20-page cap here (that cap belongs to the no-AI line import);
// a size cap is enforced upstream by assertDocumentSize. Returns [] when the PDF has no text layer.
export async function readPdfPages(bytes: ArrayBuffer): Promise<string[]> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes.slice(0)));
  try {
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = text.map((page) => page.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join("\n"));
    return pages.some((page) => page.length > 0) ? pages : [];
  } finally { await pdf.destroy(); }
}
