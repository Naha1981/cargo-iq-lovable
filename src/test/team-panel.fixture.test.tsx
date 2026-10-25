// FIXTURE RENDER (not live authz): renders TeamPanel with mocked server fns and
// fixture invitation data, then writes a standalone HTML file with the app's real
// built CSS for pixel inspection. No DB, no auth, no network.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

vi.mock("@/lib/invitations.functions", () => ({
  listInvitations: vi.fn(async () => [
    {
      id: "inv-fixture-1",
      email: "sindi@harbourview-logistics.co.za",
      role: "investigator",
      accepted_at: "2026-10-24T09:12:00Z",
      expires_at: "2026-10-28T00:00:00Z",
      expired: false,
    },
    {
      id: "inv-fixture-2",
      email: "pieter@dockside-agents.co.za",
      role: "viewer",
      accepted_at: null,
      expires_at: "2026-10-30T00:00:00Z",
      expired: false,
    },
    {
      id: "inv-fixture-3",
      email: "lara@capebulk-example.co.za",
      role: "admin",
      accepted_at: null,
      expires_at: "2026-10-20T00:00:00Z",
      expired: true,
    },
  ]),
  createInvitation: vi.fn(async () => ({ token: "fixture-token-7f3a9c2e" })),
  revokeInvitation: vi.fn(async () => ({ ok: true })),
}));

import { TeamPanel } from "@/components/TeamPanel";

describe("TeamPanel fixture render (not live)", () => {
  it("renders invite form, new-link box, and invitation states; emits static HTML", async () => {
    render(<TeamPanel />);

    // list loads with all three fixture states
    await screen.findByText("sindi@harbourview-logistics.co.za");
    expect(screen.getByText("Accepted")).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.getByText(/Expires /)).toBeTruthy();

    // create an invite -> newLink box appears
    fireEvent.change(screen.getByPlaceholderText("colleague@company.co.za"), {
      target: { value: "newhire@harbourview-logistics.co.za" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create invite link" }));
    await screen.findByText(/Invite link ready/);
    expect(screen.getByText(/\/invite\/fixture-token-7f3a9c2e/)).toBeTruthy();

    // emit standalone HTML with the real built stylesheet for pixel inspection
    const cssFile = readdirSync(".output/public/assets").find((f) => f.endsWith(".css"));
    expect(cssFile).toBeTruthy();
    const css = readFileSync(`.output/public/assets/${cssFile}`, "utf8");
    const html = `<!doctype html>
<html lang="en" class="light">
<head><meta charset="utf-8"><title>FIXTURE - Team panel (not live)</title><style>${css}</style></head>
<body><div style="max-width:52rem;margin:0 auto;padding:2rem;">${document.body.innerHTML}</div></body>
</html>`;
    writeFileSync("/tmp/team-panel-fixture.html", html);
  });
});
