import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
const state = vi.hoisted(() => ({
  review: vi.fn(),
  invalidate: vi.fn(),
  row: {
    id: "claim",
    status: "PENDING",
    claim_text: "SYNTHETIC NOT REAL",
    nature: "OBSERVED",
    evidence_class: "CUSTOMER_PRIMARY",
    confidence: 1,
  },
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => ({
    component: (opts as { component: unknown }).component,
    useParams: () => ({ caseId: "case" }),
  }),
  useRouter: () => ({ invalidate: state.invalidate }),
}));
vi.mock("./cases.$caseId", () => ({
  Route: {
    useLoaderData: () => ({
      tenantId: "tenant",
      documents: [],
      claims: [state.row],
      contradictions: [],
    }),
  },
}));
vi.mock("@/lib/case.functions", () => ({
  reviewClaim: state.review,
  acquireUploadSlot: vi.fn(),
  registerDocument: vi.fn(),
  releaseUploadSlot: vi.fn(),
  resolveContradiction: vi.fn(),
  runDocumentExtraction: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
import { DocsPage } from "./cases.$caseId.documents";
beforeEach(() => {
  vi.resetAllMocks();
  state.row.status = "PENDING";
});
it("does not show optimistic saved state while the review is pending", async () => {
  let done: (v: unknown) => void = () => {};
  state.review.mockImplementation(
    () =>
      new Promise((r) => {
        done = r;
      }),
  );
  const view = render(<DocsPage />);
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
  expect(screen.queryByText("VERIFIED")).not.toBeInTheDocument();
  done({ id: "claim", status: "VERIFIED" });
  await waitFor(() => expect(state.invalidate).toHaveBeenCalled());
  view.unmount();
});
it("surfaces database errors and keeps the original status", async () => {
  state.review.mockRejectedValue(new Error("Review was not saved: schema failure"));
  const view = render(<DocsPage />);
  fireEvent.click(screen.getByRole("button", { name: "Dispute" }));
  await screen.findByText("Review was not saved: schema failure");
  expect(screen.queryByRole("button", { name: "Disputed" })).not.toBeInTheDocument();
  view.unmount();
});
it("rejects an unconfirmed response instead of claiming success", async () => {
  state.review.mockResolvedValue(undefined);
  const view = render(<DocsPage />);
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
  await screen.findByText("Review was not confirmed saved. Reload and try again.");
  expect(state.invalidate).not.toHaveBeenCalled();
  view.unmount();
});
it("keeps an already reviewed decision locked in the UI like the database", () => {
  state.row.status = "VERIFIED";
  const view = render(<DocsPage />);
  expect(screen.getByRole("button", { name: "Verified" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Dispute" })).toBeDisabled();
  view.unmount();
});
