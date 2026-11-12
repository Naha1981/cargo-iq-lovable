import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect } from "vitest";
import { SampleVisualJourney } from "./SampleVisualJourney";
afterEach(cleanup);
describe("worked example visual journey", () => {
  it("starts on the real harbour reference, without invented shipment coordinates", () => {
    render(<SampleVisualJourney />);
    expect(screen.getByTitle("Durban reference harbour globe").getAttribute("src")).toBe(
      "/harbour-view/index.html?embed=1&sample=0",
    );
    expect(screen.getByText(/none are invented/)).toBeTruthy();
  });
  it("keeps current camera still separate from historical sample", () => {
    render(<SampleVisualJourney />);
    fireEvent.click(screen.getByRole("button", { name: "Cameras" }));
    expect(screen.getByAltText(/Unmodified PYC Marina/)).toBeTruthy();
    expect(screen.getByText(/not footage of the 14 October/)).toBeTruthy();
    expect(screen.getByText(/No server case save/)).toBeTruthy();
  });
  it("labels illustrative and real-world Gaussian sources separately", () => {
    render(<SampleVisualJourney />);
    fireEvent.click(screen.getByRole("button", { name: "3D Gaussian scene" }));
    expect(screen.getByTitle("Illustrative Gaussian harbour scene")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Real-world splat" }));
    expect(screen.getByTitle("Real-world Tree Gaussian reference")).toBeTruthy();
    expect(screen.getByText(/not a port or cargo scan/)).toBeTruthy();
  });
  it("selects a mobile visual tool without losing the source claim", () => {
    render(<SampleVisualJourney />);
    fireEvent.change(screen.getByLabelText("Visual tool"), {
      target: { value: "Saved CCTV footage" },
    });
    expect(screen.getByText("Saved CCTV references")).toBeTruthy();
    expect(screen.getByLabelText("Selected sample source claim")).toHaveValue("Q02");
    expect(screen.getByText(/Customer CCTV ingest/)).toBeTruthy();
  });
  it("retains unresolved conflict in the same-case draft", () => {
    render(<SampleVisualJourney />);
    fireEvent.click(screen.getByRole("button", { name: "Draft pack" }));
    expect(screen.getByText(/The 18:00\/19:00 gate-in conflict stays OPEN/)).toBeTruthy();
    expect(screen.getByText(/Same 15 fictional source records/)).toBeTruthy();
  });
});
