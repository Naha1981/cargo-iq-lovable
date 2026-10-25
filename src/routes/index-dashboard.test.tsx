import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createRootRoute, createRouter, createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { Route } from "./index";

// Mock the server boundary; the component under test is the REAL Index.
const registerMock = vi.fn();
vi.mock("@/lib/case.functions", () => ({
  getCaseRegisterPage: (...a: any[]) => registerMock(...a),
  getCaseDashboardStats: vi.fn(),
}));
vi.mock("@/lib/auth.functions", () => ({ getCurrentUser: vi.fn() }));

function row(id: string, over: any = {}) {
  return { id, reference_no: `DUR-2026-${id}`, port_code: "DUR", vessel_name: `Vessel ${id}`, voyage_no: "", status: "INVESTIGATING", exposure: 100, currency: "ZAR", recovery: 50, contradictions: 0, clockConflicts: false, ...over };
}
const stats = { total: 3, openCases: 3, contradictions: 0, exposureZar: 300, recoveryZar: 150, recoveryBlocked: false };

async function renderIndex(page: any) {
  vi.spyOn(Route, "useLoaderData").mockReturnValue({ session: { user: { id: "u1" } }, stats, page } as any);
  const rootRoute = createRootRoute({ component: (Route as any).options.component });
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ["/"] }) });
  await router.load();
  return render(<RouterProvider router={router} />);
}

describe("dashboard search / load-more interaction (real component)", () => {
  beforeEach(() => { registerMock.mockReset(); });

  it("load more appends the next page, dedupes, and hides the button at the end", async () => {
    await renderIndex({ rows: [row("a"), row("b")], nextCursor: { created_at: "t2", id: "b" } });
    registerMock.mockResolvedValueOnce({ rows: [row("b"), row("c")], nextCursor: null }); // overlap on boundary row b
    fireEvent.click(screen.getByText("Load more investigations"));
    await waitFor(() => expect(screen.queryByText("Load more investigations")).toBeNull());
    expect(registerMock).toHaveBeenCalledWith({ data: { q: "", cursor: { created_at: "t2", id: "b" }, limit: 100 } });
    expect(screen.getByText(/DUR-2026-c/)).toBeTruthy();
    expect(screen.getAllByText(/DUR-2026-b/)).toHaveLength(1); // deduped
  });

  it("search replaces rows after debounce with the server-filtered result", async () => {
    await renderIndex({ rows: [row("a")], nextCursor: { created_at: "t", id: "a" } });
    registerMock.mockResolvedValueOnce({ rows: [row("x")], nextCursor: null });
    fireEvent.change(screen.getByPlaceholderText(/Search reference/), { target: { value: "trader" } });
    await waitFor(() => expect(screen.getByText(/DUR-2026-x/)).toBeTruthy(), { timeout: 2000 });
    expect(screen.queryByText(/DUR-2026-a/)).toBeNull();
    expect(registerMock).toHaveBeenCalledWith({ data: { q: "trader", limit: 100 } });
  });

  it("a stale search response resolving after a newer one is discarded", async () => {
    await renderIndex({ rows: [row("a")], nextCursor: null });
    let resolveFirst!: (v: any) => void;
    registerMock
      .mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }))
      .mockResolvedValueOnce({ rows: [row("new")], nextCursor: null });
    const input = screen.getByPlaceholderText(/Search reference/);
    fireEvent.change(input, { target: { value: "first" } });
    await new Promise((r) => setTimeout(r, 350)); // let first debounce fire
    fireEvent.change(input, { target: { value: "second" } });
    await waitFor(() => expect(screen.getByText(/DUR-2026-new/)).toBeTruthy(), { timeout: 2000 });
    resolveFirst({ rows: [row("stale")], nextCursor: null }); // late response for "first"
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/DUR-2026-stale/)).toBeNull();
    expect(screen.getByText(/DUR-2026-new/)).toBeTruthy();
  });

  it("an in-flight load-more is discarded when a new search starts", async () => {
    await renderIndex({ rows: [row("a")], nextCursor: { created_at: "t", id: "a" } });
    let resolveMore!: (v: any) => void;
    registerMock
      .mockImplementationOnce(() => new Promise((r) => { resolveMore = r; }))   // load-more
      .mockResolvedValueOnce({ rows: [row("searched")], nextCursor: null });   // search
    fireEvent.click(screen.getByText("Load more investigations"));
    fireEvent.change(screen.getByPlaceholderText(/Search reference/), { target: { value: "q2" } });
    await waitFor(() => expect(screen.getByText(/DUR-2026-searched/)).toBeTruthy(), { timeout: 2000 });
    resolveMore({ rows: [row("p2")], nextCursor: { created_at: "t2", id: "p2" } }); // stale page resolves late
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/DUR-2026-p2/)).toBeNull();
    expect(screen.getByText(/DUR-2026-searched/)).toBeTruthy();
    expect(screen.queryByText("Load more investigations")).toBeNull();
  });
});
