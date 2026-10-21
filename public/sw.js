// Minimal service worker so CargoIQ is installable (PWA). No offline caching:
// evidence data must always come from the live backend.
self.addEventListener("install", (event) => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
