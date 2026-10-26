import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenImageryScene } from "@/lib/open-imagery";
const mocks = vi.hoisted(() => ({ save: vi.fn(), search: vi.fn(), preview: vi.fn() }));
vi.mock("@/lib/gehi.functions", () => ({ createGeospatialFinding: mocks.save }));
vi.mock("@/lib/open-imagery.functions", () => ({
  searchOpenImagery: mocks.search,
  loadOpenImageryPreview: mocks.preview,
}));
import { OpenImageryComparison } from "./OpenImageryComparison";
const location = {
  longitude: 31.041,
  latitude: -29.856,
  label: "Recorded reference, not terminal identity",
};
const scene: OpenImageryScene = {
  id: "S2C_36JUM_20260909_0_L2A",
  acquiredAt: "2026-09-09T08:08:26.119Z",
  cloudPercent: 0.007585,
  previewUrl:
    "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/36/J/UM/2026/9/S2C_36JUM_20260909_0_L2A/preview.jpg",
  sourceUrl:
    "https://earth-search.aws.element84.com/v1/collections/sentinel-2-l2a/items/S2C_36JUM_20260909_0_L2A",
  footprint: [
    [30, -31],
    [32, -31],
    [32, -29],
    [30, -29],
    [30, -31],
  ],
  crs: 32736,
  transform: [10, 0, 300000, 0, -10, 6700000],
  shape: [10980, 10980],
  nativeResolutionM: 10,
};
const second = { ...scene, id: "S2B_36JUM_20261024_0_L2A", acquiredAt: "2026-10-24T08:08:28.698Z" };
const props = {
  caseId: "00000000-0000-4000-8000-000000000001",
  caseLabel: "CQ-SYNTHETIC",
  location,
  initialScenes: [[scene], [second]],
  initialDates: ["2026-09-09", "2026-10-24"] as [string, string],
};
afterEach(cleanup);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.preview.mockResolvedValue({ dataUri: "data:image/jpeg;base64,/9j/2Q==" });
  mocks.save.mockResolvedValue({ id: "synthetic" });
});
async function choosePair() {
  const selects = screen.getAllByRole("combobox");
  fireEvent.change(selects[0], { target: { value: scene.id } });
  fireEvent.change(selects[1], { target: { value: second.id } });
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Unverified manual review" } });
  await waitFor(() =>
    expect(screen.getAllByLabelText("Mark manual overview region")).toHaveLength(2),
  );
  for (const svg of screen.getAllByLabelText("Mark manual overview region")) {
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    for (const [x, y] of [
      [10, 10],
      [30, 10],
      [30, 30],
    ])
      fireEvent.click(svg, { clientX: x, clientY: y });
  }
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Save unverified/ })).toBeEnabled(),
  );
}
describe("manual imagery review flow", () => {
  it("shows explicit date interpretation and case reference", () => {
    render(<OpenImageryComparison {...props} />);
    expect(screen.getByText("9 September 2026")).toBeInTheDocument();
    expect(screen.getByText("24 October 2026")).toBeInTheDocument();
    expect(screen.getByText(/Case: CQ-SYNTHETIC/)).toBeInTheDocument();
  });
  it("awaits save then refresh and refuses duplicate click", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    render(<OpenImageryComparison {...props} onSaved={refresh} />);
    await choosePair();
    fireEvent.click(screen.getByRole("button", { name: /Save unverified/ }));
    await screen.findByText(/Review saved as unverified finding synthetic/);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0].data).toMatchObject({
      caseId: props.caseId,
      confidence: "unverified",
    });
    const provenance = JSON.parse(mocks.save.mock.calls[0][0].data.rationale);
    expect(provenance.observations).toHaveLength(2);
    expect(provenance.selectedReference).toEqual({ longitude: 31.041, latitude: -29.856 });
    expect(screen.getByRole("button", { name: /Save unverified/ })).toBeDisabled();
  });
  it("does not imply failed save or permit duplicate if refresh fails", async () => {
    render(
      <OpenImageryComparison
        {...props}
        onSaved={async () => {
          throw new Error("offline");
        }}
      />,
    );
    await choosePair();
    fireEvent.click(screen.getByRole("button", { name: /Save unverified/ }));
    await screen.findByText(/Saved successfully, but refreshing findings failed/);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Save unverified/ })).toBeDisabled();
  });
  it("clears scenes and stale note when query changes", async () => {
    render(<OpenImageryComparison {...props} />);
    await choosePair();
    fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "31.04" } });
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.getByRole("button", { name: /Save unverified/ })).toBeDisabled();
    expect(screen.queryByRole("option", { name: scene.id })).not.toBeInTheDocument();
  });
});
