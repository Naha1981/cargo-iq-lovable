// Checks an evidence file set against a carrier dispute portal's STATED limits.
// Only limits found on the carrier's own page are encoded. Others return "unverified".
export interface PackFile {
  name: string;
  bytes: number;
}

export interface PortalRule {
  carrier: string;
  maxFiles: number;
  maxBytesEach: number;
  extensions: string[];
  source: string;
}

// Hapag-Lloyd: 5 files, 5MB each is stated on its global page. South Africa
// applicability and allowed file types are not verified.
export const PORTAL_RULES: PortalRule[] = [
  {
    carrier: "Hapag-Lloyd",
    maxFiles: 5,
    maxBytesEach: 5 * 1024 * 1024,
    extensions: [], // file types NOT verified: not checked
    source: "https://www.hapag-lloyd.com/en/online-business/documentation/invoice-dispute.html",
  },
];

export type PortalFit =
  | { status: "unverified"; carrier: string; reason: string }
  | { status: "ok" | "fails"; carrier: string; problems: string[]; source: string };

export function checkPortalFit(carrier: string, files: PackFile[]): PortalFit {
  const rule = PORTAL_RULES.find((r) => r.carrier.toLowerCase() === carrier.toLowerCase());
  if (!rule)
    return {
      status: "unverified",
      carrier,
      reason: "No upload limits recorded for this carrier from its own page.",
    };
  const problems: string[] = [];
  if (files.length > rule.maxFiles) problems.push(`${files.length} files, limit ${rule.maxFiles}`);
  for (const f of files) {
    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (rule.extensions.length && !rule.extensions.includes(ext))
      problems.push(`${f.name}: type .${ext} not allowed`);
    if (f.bytes > rule.maxBytesEach) problems.push(`${f.name}: over ${rule.maxBytesEach} bytes`);
  }
  return { status: problems.length ? "fails" : "ok", carrier, problems, source: rule.source };
}
