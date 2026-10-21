// Deep link into the in-app live harbour view for the case's port when we know it.
// The page is served from this repo at public/harbour-view/ (folded from the old
// standalone site); the old hosted map stays live until the cutover completes.
export function liveHarbourHref(portCode?: string | null): string {
  const code = (portCode ?? "").trim().toUpperCase();
  if (code === "ZADUR" || code === "DUR") return "/harbour-view/index.html?fly=durban";
  if (code === "ZARCB" || code === "RCB") return "/harbour-view/index.html?fly=richards";
  return "/harbour-view/index.html";
}
