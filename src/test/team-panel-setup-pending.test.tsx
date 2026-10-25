// The tenant_invitations migration is not applied to every project yet. When the
// RPC is missing the panel must show a truthful pending state with the form
// disabled - never a raw framework/JS error string.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/invitations.functions", () => ({
  INVITES_NOT_INSTALLED: "INVITES_NOT_INSTALLED",
  listInvitations: vi.fn(async () => {
    throw new Error("INVITES_NOT_INSTALLED");
  }),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
}));

import { TeamPanel } from "@/components/TeamPanel";

describe("TeamPanel when invitations are not installed yet", () => {
  it("shows a truthful pending notice, disables the form, and hides raw errors", async () => {
    render(<TeamPanel />);
    await screen.findByText(/Team invites are being set up for this workspace/);
    expect(screen.getByRole("button", { name: "Create invite link" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(screen.getByPlaceholderText("colleague@company.co.za")).toHaveProperty("disabled", true);
    expect(screen.queryByText(/INVITES_NOT_INSTALLED/)).toBeNull();
    expect(screen.queryByText(/Cannot read properties/)).toBeNull();
  });
});
