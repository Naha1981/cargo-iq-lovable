import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DdEvidencePackV0 } from "./DdEvidencePackV0";

const type = (ph: string, v: string) =>
  fireEvent.change(screen.getByPlaceholderText(ph), { target: { value: v } });

describe("DdEvidencePackV0", () => {
  it("recomputes the synthetic container and keeps unverified evidence out of the amount", () => {
    render(<DdEvidencePackV0 />);
    type("Discharge date YYYY-MM-DD", "2026-05-01");
    type("Gate-out date YYYY-MM-DD", "2026-05-07");
    type("Invoice amount (ZAR)", "13000");
    expect(screen.getByTestId("known-total").textContent).toContain("11480.00");
    expect(screen.getByText(/arithmetic_discrepancy.*1520.00/)).toBeTruthy();
    type(
      "Days you say the terminal or carrier delayed (YYYY-MM-DD, comma separated)",
      "2026-05-04",
    );
    type("Evidence description", "Synthetic notice");
    type("Evidence source (document name or link)", "notice.pdf");
    type("Captured at (ISO date-time)", "2026-05-05T09:00:00Z");
    type("Covers from YYYY-MM-DD", "2026-05-04");
    type("Covers to YYYY-MM-DD", "2026-05-04");
    fireEvent.click(screen.getByText("Add evidence"));
    expect(screen.getByText(/unsupported_claim.*no amount counted/)).toBeTruthy();
    fireEvent.click(screen.getByText("Mark verified"));
    expect(screen.getByText(/potentially_disputable.*2698.00/)).toBeTruthy();
  });
});
