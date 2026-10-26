import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ context: { tenantId: "T", supabase: { from: vi.fn() } } }));
vi.mock("@/lib/auth-middleware", () => ({ tenantMiddleware: {} }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const b = {
      validator: () => b,
      middleware: () => b,
      handler: (fn: (a: unknown) => unknown) => (a: { data: unknown }) =>
        fn({ ...a, context: state.context }),
    };
    return b;
  },
}));
import { searchOpenImagery, loadOpenImageryPreview } from "./open-imagery.functions";
beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: null, error: null }),
  };
  state.context.supabase.from = vi.fn(() => q);
});
describe("public imagery server effects", () => {
  it("refuses unavailable/cross-tenant case before provider", async () => {
    await expect(
      searchOpenImagery({
        data: { caseId: "x", longitude: 31, latitude: -30, date: "2026-09-09" },
      }),
    ).rejects.toThrow("Case unavailable");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses redirect refusal and bounded timeout for preview", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(new Uint8Array([255, 216, 255, 217]), {
        headers: { "content-type": "image/jpeg" },
      }),
    );
    const result = await loadOpenImageryPreview({
      data: {
        url: "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/36/J/UM/2026/9/S2C_36JUM_20260909_0_L2A/preview.jpg",
      },
    });
    expect(result.dataUri).toMatch(/^data:image\/jpeg;base64,/);
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }),
    );
  });
  it("propagates provider redirect/timeout rejection without retry", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("redirect refused"));
    await expect(
      loadOpenImageryPreview({
        data: {
          url: "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/36/J/UM/2026/9/S2C_36JUM_20260909_0_L2A/preview.jpg",
        },
      }),
    ).rejects.toThrow("redirect refused");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
