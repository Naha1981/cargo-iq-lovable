import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
const state = vi.hoisted(() => ({ save: vi.fn(), invalidate: vi.fn(), navigate: vi.fn() }));
vi.mock("@/lib/recovery-request", () => ({
  recoveryRequestKey: async () => "f0000000-0000-4000-8000-000000000001",
  clearRecoveryRequest: async () => {},
}));
vi.mock("./cases.$caseId", () => ({
  Route: {
    useLoaderData: () => ({
      case: {
        id: "c0000000-0000-4000-8000-000000000001",
        port_code: "ZADUR",
        reference_no: "SYNTH",
      },
      timeline: [],
    }),
  },
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (o: unknown) => o,
  useRouter: () => ({ invalidate: state.invalidate, navigate: state.navigate }),
}));
vi.mock("@/lib/historical-review.functions", () => ({ saveHistoricalReview: state.save }));
import { Route } from "./cases.$caseId.live-harbour";
const selection = {
  date: "2025-12-03",
  place: "SYNTHETIC candidate",
  lat: -29.856,
  lon: 31.041,
  records: [{ id: "foreign" }],
};
beforeEach(() => {
  vi.clearAllMocks();
  state.save.mockResolvedValue({ observationId: "synthetic", recordCount: 1 });
});
function setup() {
  const Component = (Route as unknown as { component: () => React.ReactNode }).component;
  const view = render(<Component />);
  const frame = view.container.querySelector("iframe")!;
  return {
    ...view,
    frame,
    propose: (origin = location.origin, source = frame.contentWindow) =>
      fireEvent(
        window,
        new MessageEvent("message", {
          origin,
          source,
          data: { type: "cargo-history-contribution", selection },
        }),
      ),
  };
}
it("ignores foreign origin/source; review precedes save, ignores supplied records", async () => {
  const { propose, unmount } = setup();
  propose("https://untrusted.invalid");
  propose(location.origin, window);
  expect(screen.queryByText("Confirm historical record review")).toBeNull();
  propose();
  expect(state.save).not.toHaveBeenCalled();
  expect(screen.getByText(/not independent sensor evidence/)).toBeTruthy();
  fireEvent.click(screen.getByText("Confirm and save to case"));
  await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1));
  const body = state.save.mock.calls[0][0].data;
  expect(body.caseId).toBe("c0000000-0000-4000-8000-000000000001");
  expect(body.confirmed).toBe(true);
  expect(body).not.toHaveProperty("records");
  await screen.findByText(/Generate a new pack/);
  unmount();
});
it("cancel never writes; uncertain retry reuses the reviewed request ID", async () => {
  const { propose, unmount } = setup();
  propose();
  fireEvent.click(screen.getByText("Cancel"));
  expect(state.save).not.toHaveBeenCalled();
  state.save.mockRejectedValueOnce(new Error("Save not confirmed"));
  propose();
  fireEvent.click(screen.getByText("Confirm and save to case"));
  await screen.findByText("Save not confirmed");
  fireEvent.click(screen.getByText("Confirm and save to case"));
  await waitFor(() => expect(state.save).toHaveBeenCalledTimes(2));
  expect(state.save.mock.calls[0][0].data.requestId).toBe(
    state.save.mock.calls[1][0].data.requestId,
  );
  unmount();
});
