import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/dd.functions", () => ({
  getDdFollowUps: vi.fn().mockResolvedValue([]),
  getRecoveryReport: vi.fn().mockResolvedValue([]),
  ingestDdEvidence: vi.fn().mockResolvedValue([]),
  recordClaimEvent: vi.fn(),
  recordClaimSent: vi.fn(),
  runManagedDd: vi.fn(),
}));
vi.mock("@/lib/revenue-recovery.functions", () => ({
  listRecoveryFindings: vi.fn().mockResolvedValue([]),
  updateRecoveryStatus: vi.fn(),
}));
import { ManagedDd } from "./ManagedDd";

const type = (ph: string, v: string) =>
  fireEvent.change(screen.getByPlaceholderText(ph), { target: { value: v } });

describe("ManagedDd", () => {
  it("classifies the synthetic R18,500 case and builds a letter that is blocked until evidence is attached", async () => {
    const { container } = render(<ManagedDd caseId="c1" documents={[]} />);
    type("Container no.", "MSCU6639870");
    type("Carrier", "Synthetic Line");
    type("Free days", "3");
    type("Daily rate (per unit)", "3700");
    for (const [label, v] of [
      ["Discharge date", "2026-03-01"],
      ["Gate-out date", "2026-03-09"],
    ])
      fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
    fireEvent.change(container.querySelector("textarea[placeholder^='Carrier invoices']")!, {
      target: { value: "INV-1001 | demurrage | 5 | 18500" },
    });
    fireEvent.change(container.querySelector("textarea[placeholder^='Delay events']")!, {
      target: { value: "2026-03-04 | 2026-03-08 | terminal | Gate outage | notice.txt" },
    });
    type("Billed to customer so far (leave blank if unknown)", "0");
    fireEvent.change(container.querySelector("textarea[placeholder^='Contract or tariff']")!, {
      target: { value: "Clause 7.2" },
    });
    type("Your company", "Synthetic Forwarding");
    type("Your name", "A. Tester");
    await waitFor(() =>
      expect(screen.getAllByText(/5 chargeable day\(s\)/).length).toBeGreaterThan(0),
    );
    expect(screen.getByText("Disputable with carrier / terminal")).toBeTruthy();
    expect(screen.getByText(/Credit requested: ZAR 18500.00/)).toBeTruthy();
    // No documents are tagged in this test, so the letter must refuse to be "ready".
    expect(screen.getByText("Not ready")).toBeTruthy();
    expect(screen.getByText(/Carrier invoice is not attached/)).toBeTruthy();
    expect(screen.getByText("Save claim(s) to this case")).toBeTruthy();
    expect(screen.getByText("No submitted claims yet.")).toBeTruthy();
  });
});
