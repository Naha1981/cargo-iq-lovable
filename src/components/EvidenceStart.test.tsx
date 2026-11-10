import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => (
    <a href="#documents" {...props}>
      {children}
    </a>
  ),
}));
import { EvidenceStart } from "./EvidenceStart";
afterEach(cleanup);
describe("guided evidence starts", () => {
  it("shows the source-first path without inventing evidence", () => {
    render(
      <EvidenceStart
        title="No records yet"
        steps={["Choose source", "Record original", "Review"]}
        caseId="synthetic"
        hasDocuments={false}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Start with a document" })).toBeTruthy();
  });
  it("does not ask for another document when case documents exist", () => {
    render(
      <EvidenceStart
        title="No records yet"
        steps={["Choose source"]}
        caseId="synthetic"
        hasDocuments
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
  it("retains all groups, map link and direct evidence review routes", () => {
    const layout = readFileSync("src/routes/cases.$caseId.tsx", "utf8");
    for (const group of ["Overview", "Documents & evidence", "Maps", "Money", "Evidence pack"])
      expect(layout).toContain(group);
    expect(layout).toContain("https://canvas.nahalabs.co.za/#/t/cargoiq");
    const docs = readFileSync("src/routes/cases.$caseId.documents.tsx", "utf8");
    expect(docs).toContain('href="#contradictions"');
    expect(docs).toContain('id="contradictions"');
    for (const name of ["financials", "recovery"])
      expect(readFileSync(`src/routes/cases.$caseId.${name}.tsx`, "utf8")).toContain(
        "Review unresolved contradictions",
      );
  });
});
