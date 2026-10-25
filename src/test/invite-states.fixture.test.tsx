// FIXTURE RENDER (not live authz): renders every invite-accept state with fixture
// state objects (no DB, no auth, no network) and emits static HTML with the app's
// real built CSS for pixel inspection.
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import type { ReactNode } from "react";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({}),
  Link: ({ to, children }: { to: string; children?: ReactNode }) => <a href={to}>{children}</a>,
}));

import { InviteStateView, type InviteState } from "@/routes/invite.$token";

const states: Array<[string, InviteState]> = [
  ["working", { kind: "working" }],
  ["signed_out", { kind: "signed_out" }],
  ["joined", { kind: "joined" }],
  ["already_member", { kind: "already_member" }],
  ["email_mismatch", { kind: "email_mismatch" }],
  ["invalid_or_expired", { kind: "invalid_or_expired" }],
  ["error", { kind: "error", message: "Network unreachable (fixture)" }],
];

describe("Invite accept states fixture render (not live)", () => {
  it("renders all seven states and emits static HTML", () => {
    const cssFile = readdirSync(".output/public/assets").find((f) => f.endsWith(".css"));
    const css = readFileSync(`.output/public/assets/${cssFile}`, "utf8");
    const sections: string[] = [];
    for (const [name, state] of states) {
      const { container, unmount } = render(<InviteStateView state={state} />);
      expect(container.textContent!.length).toBeGreaterThan(10);
      sections.push(
        `<div style="margin-bottom:1.5rem;"><p style="font:600 12px sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;margin:0 0 .5rem;">STATE: ${name}</p><div style="max-width:36rem;">${container.innerHTML}</div></div>`,
      );
      unmount();
    }
    const html = `<!doctype html>
<html lang="en" class="light">
<head><meta charset="utf-8"><title>FIXTURE - invite accept states (not live)</title><style>${css}</style></head>
<body><div style="max-width:44rem;margin:0 auto;padding:2rem;">${sections.join("\n")}</div></body>
</html>`;
    writeFileSync("/tmp/invite-states-fixture.html", html);
  });
});
