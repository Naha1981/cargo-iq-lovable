import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { DdEvidencePackV0 } from "./DdEvidencePackV0";
import { emptyDdCaseDraft, type DdCaseDraft } from "@/lib/dd-case-draft";
const store = vi.hoisted(() => ({
  value: null as unknown,
  revision: 0,
  failLoad: false,
  failSave: false,
}));
vi.mock("@/lib/dd-case-draft.functions", () => ({
  loadDdCaseDraft: vi.fn(async () => {
    if (store.failLoad) throw new Error("offline");
    return { draft: store.value, revision: store.revision };
  }),
  saveDdCaseDraft: vi.fn(async ({ data }: { data: { draft: DdCaseDraft; revision: number } }) => {
    if (store.failSave || data.revision !== store.revision) throw new Error("DRAFT_CONFLICT");
    store.value = structuredClone(data.draft);
    store.revision += 1;
    return { revision: store.revision };
  }),
}));
const CASE = "00000000-0000-4000-8000-000000000001";
const type = (ph: string, v: string) =>
  fireEvent.change(screen.getByPlaceholderText(ph), { target: { value: v } });
const ready = async () => {
  await screen.findByText("No saved draft yet.");
};
beforeEach(() => {
  cleanup();
  store.value = null;
  store.revision = 0;
  store.failLoad = false;
  store.failSave = false;
});
describe("DdEvidencePackV0", () => {
  it("recomputes and keeps unverified evidence out of the amount", async () => {
    render(<DdEvidencePackV0 caseId={CASE} />);
    await ready();
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
    expect(screen.getByText("Download draft pack (PDF)")).toBeTruthy();
  });
  it("saves every field and evidence review state, then restores on remount", async () => {
    const { unmount } = render(<DdEvidencePackV0 caseId={CASE} />);
    await ready();
    type("Container no.", "SYNTHETIC");
    type("Discharge date YYYY-MM-DD", "2026-05-01");
    type("Gate-out date YYYY-MM-DD", "2026-05-07");
    type("Invoice no.", "QA-1");
    type("Invoice amount (ZAR)", "13000");
    type("Evidence description", "Synthetic notice");
    type("Evidence source (document name or link)", "notice.pdf");
    type("Covers from YYYY-MM-DD", "2026-05-04");
    type("Covers to YYYY-MM-DD", "2026-05-04");
    fireEvent.click(screen.getByText("Add evidence"));
    fireEvent.click(screen.getByText("Mark verified"));
    fireEvent.click(screen.getByText("Save draft to case"));
    await screen.findByText("Draft saved to this case.");
    unmount();
    render(<DdEvidencePackV0 caseId={CASE} />);
    await screen.findByText("Draft saved to this case.");
    expect((screen.getByPlaceholderText("Container no.") as HTMLInputElement).value).toBe(
      "SYNTHETIC",
    );
    expect((screen.getByPlaceholderText("Invoice no.") as HTMLInputElement).value).toBe("QA-1");
    expect(screen.getByText(/E1.*VERIFIED/)).toBeTruthy();
    expect(screen.getByTestId("known-total").textContent).toContain("11480.00");
  });
  it("keeps unsaved inputs and reports failure instead of claiming saved", async () => {
    render(<DdEvidencePackV0 caseId={CASE} />);
    await ready();
    store.failSave = true;
    type("Container no.", "KEEP-ME");
    fireEvent.click(screen.getByText("Save draft to case"));
    await screen.findByText(/Draft not saved/);
    expect((screen.getByPlaceholderText("Container no.") as HTMLInputElement).value).toBe(
      "KEEP-ME",
    );
    expect(screen.queryByText("Draft saved to this case.")).toBeNull();
  });
  it("fails closed on load failure", async () => {
    store.failLoad = true;
    render(<DdEvidencePackV0 caseId={CASE} />);
    await screen.findByText("Case draft unavailable");
    expect((screen.getByText("Save draft to case") as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByPlaceholderText("Container no.") as HTMLInputElement).disabled ||
        screen.getByPlaceholderText("Container no.").closest("fieldset")?.disabled,
    ).toBe(true);
  });
  it("rejects a concurrent stale revision without overwriting saved data", async () => {
    render(<DdEvidencePackV0 caseId={CASE} />);
    await ready();
    store.revision = 1;
    store.value = { ...emptyDdCaseDraft(), containerNo: "OTHER-EDITOR" };
    type("Container no.", "STALE");
    fireEvent.click(screen.getByText("Save draft to case"));
    await screen.findByText(/Draft not saved/);
    expect((store.value as DdCaseDraft).containerNo).toBe("OTHER-EDITOR");
  });
});
