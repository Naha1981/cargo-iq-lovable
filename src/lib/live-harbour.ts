// Deep link into the NahaLabs live harbour view for the case's port when we know it.
export function liveHarbourHref(portCode?: string | null): string {
  const code = (portCode ?? "").trim().toUpperCase();
  if (code === "ZADUR" || code === "DUR") return "https://nahalabs.co.za/harbour-view?fly=durban";
  if (code === "ZARCB" || code === "RCB") return "https://nahalabs.co.za/harbour-view?fly=richards";
  return "https://nahalabs.co.za/harbour-view";
}
