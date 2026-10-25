// Verifies the robust blob-download helper: anchor is attached to the document
// before click (Firefox ignores detached anchors), the anchor is removed after,
// and the object URL is revoked only after a delay (sync revoke races/cancels
// the download in Firefox).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadBlob } from "@/routes/cases.$caseId.pack";

describe("downloadBlob", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:fixture-url"),
      revokeObjectURL: vi.fn(),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("attaches, clicks, removes the anchor, and defers revoke", () => {
    let attachedAtClick = false;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      attachedAtClick = document.body.contains(this);
    });
    downloadBlob(new Blob(["x"], { type: "application/pdf" }), "DUR-1-pack-v2.pdf", 1000);

    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(attachedAtClick).toBe(true);
    // anchor removed from the document after click
    expect(document.querySelector('a[download="DUR-1-pack-v2.pdf"]')).toBeNull();
    // not revoked synchronously (Firefox race fix)
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fixture-url");
    clickSpy.mockRestore();
  });
});
