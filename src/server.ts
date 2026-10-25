import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

// Security headers delivered by the worker itself (audit item 7). public/_headers is kept
// for any host route that honors it, but the current host does not - so every response the
// worker hands out (SSR pages, server functions, redirects, and our own error pages) gets
// the baseline set here, and /harbour-view/* gets its scoped CSP. Existing headers set
// upstream are never overwritten. Response bodies, statuses and cookies pass through
// untouched; only headers are added.
const BASELINE_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
};
// Keep in sync with the /harbour-view/* block in public/_headers.
const HARBOUR_VIEW_CSP =
  "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com 'wasm-unsafe-eval' 'unsafe-eval'; " +
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; " +
  "img-src 'self' data: blob: https://server.arcgisonline.com https://cdn.jsdelivr.net; " +
  "connect-src 'self' https://yeaflwgwrjznigykplur.supabase.co wss://yeaflwgwrjznigykplur.supabase.co https://naha1981.github.io " +
  "wss://cargoiq-gods-eye.onrender.com https://cargoiq-gods-eye.onrender.com https://api.open-meteo.com https://marine-api.open-meteo.com " +
  "https://terrain.reearth.land https://cdn.jsdelivr.net https://server.arcgisonline.com; " +
  "worker-src 'self' blob: https://cdn.jsdelivr.net; frame-src https://restreamer.cd.net.za; " +
  "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";

// Report-only CSP for the app shell (audit item 8). Phase 1 of a staged rollout:
// report-only can never block a resource, so it is safe to ship before every
// client-side call is inventoried; violations are visible in devtools and the
// staging preview must be exercised against this policy before any enforcing
// CSP is considered. Kept deliberately permissive (inline scripts/styles from
// the SSR bootstrap) and scoped to HTML page responses - JSON/server-function
// responses and /harbour-view/* (which has its own enforced CSP) are untouched.
const APP_CSP_REPORT_ONLY =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https:; font-src 'self' data:; " +
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.open-meteo.com " +
  "https://marine-api.open-meteo.com https://stac.dataspace.copernicus.eu; " +
  "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";

export function withSecurityHeaders(request: Request, response: Response): Response {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(BASELINE_HEADERS)) {
    if (!out.headers.has(name)) out.headers.set(name, value);
  }
  const path = new URL(request.url).pathname;
  if (path.startsWith("/harbour-view/")) {
    if (!out.headers.has("content-security-policy")) {
      out.headers.set("content-security-policy", HARBOUR_VIEW_CSP);
    }
    return out;
  }
  const isHtml = (out.headers.get("content-type") ?? "").includes("text/html");
  if (
    isHtml &&
    !out.headers.has("content-security-policy") &&
    !out.headers.has("content-security-policy-report-only")
  ) {
    out.headers.set("content-security-policy-report-only", APP_CSP_REPORT_ONLY);
  }
  return out;
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(request, await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(
        request,
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      );
    }
  },
};
