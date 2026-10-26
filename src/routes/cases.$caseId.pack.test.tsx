import { it, expect, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
const state = vi.hoisted(() => ({
  payload: {
    case: { reference_no: "SYNTHETIC-CORE" },
    documents: [{ id: "doc-core" }],
    claims: [{ claim_text: "CLAIM-CORE" }],
    timeline: [{ title: "TIMELINE-CORE" }],
    financialCalculations: [{ id: "FINANCE-CORE" }],
    operationalClocks: [{ id: "CLOCK-CORE" }],
  },
  blobs: [] as Blob[],
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => () => ({ useParams: () => ({ caseId: "C" }) }),
  useRouter: () => ({ invalidate: async () => {} }),
}));
vi.mock("./cases.$caseId", () => ({
  Route: {
    useLoaderData: () => ({
      clockBlocked: false,
      contradictions: [],
      packs: [
        {
          id: "P",
          version: 7,
          sha256_hash: "sealed-hash",
          status: "DRAFT",
          generated_at: "2026-10-26T12:00:00Z",
        },
      ],
    }),
  },
}));
vi.mock("@/lib/case.functions", () => ({
  getEvidencePackPayload: async () => ({ pack_payload: state.payload }),
  approveEvidencePack: vi.fn(),
  generateEvidencePack: vi.fn(),
}));
import { PackPage } from "./cases.$caseId.pack";
it("actual summary export includes all sealed core registers and version/hash/status header", async () => {
  vi.stubGlobal("URL", {
    createObjectURL: (blob: Blob) => {
      state.blobs.push(blob);
      return "blob:synthetic";
    },
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const view = render(<PackPage />);
  const button = Array.from(view.container.querySelectorAll("button")).find((x) =>
    x.textContent?.includes("Summary"),
  );
  expect(button).toBeTruthy();
  fireEvent.click(button!);
  await waitFor(() => expect(state.blobs).toHaveLength(1));
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(state.blobs[0]);
  });
  for (const marker of [
    "v7",
    "sealed-hash",
    "DRAFT",
    "SYNTHETIC-CORE",
    "doc-core",
    "CLAIM-CORE",
    "TIMELINE-CORE",
    "FINANCE-CORE",
    "CLOCK-CORE",
  ])
    expect(text).toContain(marker);
  view.unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
