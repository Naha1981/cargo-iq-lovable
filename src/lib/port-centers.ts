/** Approximate operational query centers, not berth coordinates or live positions.
 * Coordinates checked with geocoding on 15 October 2026:
 * Durban: Transnet Durban Container Terminal Pier 2
 * Cape Town: Transnet Cape Town Container Terminal
 * Richards Bay: Port of Richards Bay (Alton port area)
 * Unknown/missing codes must never silently become Durban.
 */
const centers: Record<string, [number, number]> = {
  ZADUR: [-29.8876004, 31.0160089],
  ZACPT: [-33.9130029, 18.4548808],
  ZARCB: [-28.7912542, 32.0363861],
};
const aliases: Record<string, string> = {
  DURBAN: "ZADUR", DUR: "ZADUR", "PORT OF DURBAN": "ZADUR",
  "CAPE TOWN": "ZACPT", CPT: "ZACPT", "PORT OF CAPE TOWN": "ZACPT",
  "RICHARDS BAY": "ZARCB", RCB: "ZARCB", "PORT OF RICHARDS BAY": "ZARCB",
};
export function resolvePortCenter(portCode: string | null | undefined): [number, number] {
  const raw = (portCode ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  const center = centers[aliases[raw] ?? raw.replace(/\s/g, "")];
  if (!center) throw new Error("Unsupported or missing case port. Set ZADUR (Durban), ZACPT (Cape Town) or ZARCB (Richards Bay), or configure a verified port center before corroborating.");
  return [...center];
}
