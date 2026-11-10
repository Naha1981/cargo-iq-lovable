import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarbourCameras } from "./HarbourCameras";
afterEach(cleanup);
describe("case Harbour Cameras", () => {
  it("opens a clear in-case viewer and keeps it outside evidence packs", () => {
    render(<HarbourCameras />);
    fireEvent.click(screen.getByRole("button", { name: "Cameras" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/No video is saved to your evidence pack/)).toBeTruthy();
    expect(screen.getByTitle(/public player/).getAttribute("src")).toContain("c1b53a50");
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.change(screen.getByLabelText("Choose a view"), { target: { value: "1" } });
    expect(screen.getByTitle(/public player/).getAttribute("src")).toContain("7bd8fb34");
    fireEvent.click(screen.getByRole("button", { name: "Reload camera" }));
    expect(screen.getByTitle(/public player/).getAttribute("src")).toContain("7bd8fb34");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
  it("close removes the provider frame", () => {
    render(<HarbourCameras />);
    fireEvent.click(screen.getByRole("button", { name: "Cameras" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTitle(/public player/)).toBeNull();
  });
});
