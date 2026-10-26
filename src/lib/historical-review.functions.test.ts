import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ role: "investigator", rpc: vi.fn(), integrated: vi.fn() }));
vi.mock("@/lib/auth-middleware", () => ({ tenantMiddleware: {} }));
vi.mock("@/lib/integrated-feature-gate", () => ({
  requireIntegratedFeatureReady: state.integrated,
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const b = {
      validator: () => b,
      middleware: () => b,
      handler: (fn: (arg: unknown) => unknown) => (arg: unknown) =>
        fn({ ...(arg as object), context: { role: state.role, supabase: { rpc: state.rpc } } }),
    };
    return b;
  },
}));
import { saveHistoricalReview } from "./historical-review.functions";
const data = {
  caseId: "c0000000-0000-4000-8000-000000000001",
  requestId: "f0000000-0000-4000-8000-000000000001",
  date: "2025-12-03",
  place: "Reference",
  lat: -29.856,
  lon: 31.041,
  confirmed: true as const,
};
beforeEach(() => {
  vi.resetAllMocks();
  state.role = "investigator";
  state.rpc.mockResolvedValue({ data: { ready: true }, error: null });
});
it("viewer denied before database access", async () => {
  state.role = "viewer";
  await expect(saveHistoricalReview({ data })).rejects.toThrow("Investigator access required");
  expect(state.rpc).not.toHaveBeenCalled();
});
it("unready or missing historical safeguards refuses before save", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: "missing" } });
  await expect(saveHistoricalReview({ data })).rejects.toThrow("not activated");
  expect(state.rpc).toHaveBeenCalledTimes(1);
});
it("existing integrated gate remains required", async () => {
  state.integrated.mockRejectedValue(new Error("NOT_READY"));
  await expect(saveHistoricalReview({ data })).rejects.toThrow("NOT_READY");
  expect(state.rpc).not.toHaveBeenCalled();
});
it("only sends reviewed filter, no supplied record payload", async () => {
  state.rpc
    .mockResolvedValueOnce({ data: { ready: true }, error: null })
    .mockResolvedValueOnce({ data: { observationId: "saved", recordCount: 0 }, error: null });
  expect(await saveHistoricalReview({ data })).toEqual({ observationId: "saved", recordCount: 0 });
  expect(state.rpc.mock.calls[1]).toEqual([
    "save_historical_record_review",
    {
      p_case_id: data.caseId,
      p_request_id: data.requestId,
      p_date: data.date,
      p_place: data.place,
      p_lat: data.lat,
      p_lon: data.lon,
      p_confirmed: true,
    },
  ]);
});
it("does not claim save after RPC error", async () => {
  state.rpc
    .mockResolvedValueOnce({ data: { ready: true }, error: null })
    .mockResolvedValueOnce({ data: null, error: { message: "rollback" } });
  await expect(saveHistoricalReview({ data })).rejects.toThrow("not confirmed saved");
});
