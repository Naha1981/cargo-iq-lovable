export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_TEXT_CHARACTERS = 200_000;
export const MAX_TEXT_LINES = 500;
export function isPlainDocument(type: string, name: string) {
  return type === "text/plain" || type === "text/csv" || /\.(csv|txt)$/i.test(name);
}
export function assertDocumentSize(size: number) {
  if (size > MAX_DOCUMENT_BYTES) throw new Error("This file is over 5 MB. Split it into smaller files before uploading or extracting.");
}
export function plainTextClaims(text: string) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (text.length > MAX_TEXT_CHARACTERS || lines.length > MAX_TEXT_LINES) {
    throw new Error("Text mode accepts up to 200,000 characters and 500 non-empty lines per file. Split the file and try again; nothing has been extracted.");
  }
  return lines;
}
export const PDF_AI_UNAVAILABLE = "AI document reading is unavailable or its credits are exhausted. Your uploaded file is safe. No payment is required: save the relevant PDF text as a TXT or CSV file, upload it, then choose Import text (no AI credits). Scanned PDFs need transcription first. Text mode does not understand events or create timestamps automatically; review every imported line.";
