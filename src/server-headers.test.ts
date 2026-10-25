import { describe, expect, it } from "vitest";
import { withSecurityHeaders } from "./server";

const req = (path: string) => new Request("https://cargoiq.nahalabs.co.za" + path);

describe("worker security headers", () => {
  it("adds the baseline set to a normal SSR page response without touching body/status/cookies", async () => {
    const original = new Response("<html>case register</html>", {
      status: 200,
      headers: {
        "content-type": "text/html",
        "set-cookie": "session=abc; HttpOnly",
        "cache-control": "no-store",
      },
    });
    const out = withSecurityHeaders(req("/"), original);
    expect(out.status).toBe(200);
    expect(await out.text()).toBe("<html>case register</html>");
    expect(out.headers.get("set-cookie")).toBe("session=abc; HttpOnly");
    expect(out.headers.get("cache-control")).toBe("no-store");
    expect(out.headers.get("x-content-type-options")).toBe("nosniff");
    expect(out.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(out.headers.get("x-frame-options")).toBe("DENY");
    expect(out.headers.get("permissions-policy")).toContain("camera=()");
    expect(out.headers.get("content-security-policy")).toBeNull(); // no CSP on SPA pages yet
  });

  it("covers redirects (3xx) and error (500) responses", () => {
    const redirect = withSecurityHeaders(
      req("/cases"),
      new Response(null, { status: 302, headers: { location: "/auth" } }),
    );
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe("/auth");
    expect(redirect.headers.get("x-frame-options")).toBe("DENY");
    const error = withSecurityHeaders(req("/"), new Response("boom", { status: 500 }));
    expect(error.status).toBe(500);
    expect(error.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("never overwrites an upstream-set header", () => {
    const upstream = new Response("ok", {
      headers: { "x-frame-options": "SAMEORIGIN", "content-security-policy": "default-src 'none'" },
    });
    const out = withSecurityHeaders(req("/harbour-view/index.html"), upstream);
    expect(out.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(out.headers.get("content-security-policy")).toBe("default-src 'none'");
  });

  it("scopes the harbour-view CSP to /harbour-view/* paths only", () => {
    const hv = withSecurityHeaders(req("/harbour-view/index.html"), new Response("<html></html>"));
    const csp = hv.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("wasm-unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'"); // no inline escape hatch
    const other = withSecurityHeaders(req("/diagnostics"), new Response("<html></html>"));
    expect(other.headers.get("content-security-policy")).toBeNull();
  });
});

describe("app-shell report-only CSP (phase 1: never blocks)", () => {
  const html = () =>
    new Response("<html>app</html>", { status: 200, headers: { "content-type": "text/html" } });

  it("adds a report-only CSP to SSR HTML pages", () => {
    const out = withSecurityHeaders(req("/cases"), html());
    const csp = out.headers.get("content-security-policy-report-only");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("https://*.supabase.co");
    expect(out.headers.get("content-security-policy")).toBeNull();
  });

  it("leaves JSON/server-function responses without any CSP", () => {
    const json = new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const out = withSecurityHeaders(req("/cases"), json);
    expect(out.headers.get("content-security-policy-report-only")).toBeNull();
    expect(out.headers.get("content-security-policy")).toBeNull();
  });

  it("keeps the enforced harbour-view CSP and adds no report-only header there", () => {
    const out = withSecurityHeaders(req("/harbour-view/map"), html());
    expect(out.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(out.headers.get("content-security-policy-report-only")).toBeNull();
  });

  it("never overwrites an upstream CSP or report-only header", () => {
    const upstream = new Response("<html>app</html>", {
      status: 200,
      headers: {
        "content-type": "text/html",
        "content-security-policy-report-only": "default-src 'none'",
      },
    });
    const out = withSecurityHeaders(req("/"), upstream);
    expect(out.headers.get("content-security-policy-report-only")).toBe("default-src 'none'");
  });
});
