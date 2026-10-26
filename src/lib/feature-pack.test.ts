import { describe, expect, it } from "vitest";
import {
  FEATURE_PACK_SECTIONS,
  featurePackSections,
  featurePackSummary,
  frozenPackSummary,
} from "./feature-pack";
import { buildEvidencePackPdf } from "./pack-pdf";
describe("frozen integrated feature contribution", () => {
  const payload = {
    integratedFeaturesVersion: "1",
    ...Object.fromEntries(
      FEATURE_PACK_SECTIONS.map(([, key]) => [
        key,
        [
          {
            id: key + "-fixture",
            title: "SYNTHETIC " + key,
            source: "synthetic source",
            status: "unverified",
            limitations: "No causal proof",
            next_action: "Human review required",
          },
        ],
      ]),
    ),
  };
  it("includes every case-linked register, source and uncertainty in summary and PDF", () => {
    const text = featurePackSummary(payload);
    const pdf = Buffer.from(
      buildEvidencePackPdf({ version: 1, status: "DRAFT", test_hash: true, pack_payload: payload }),
    ).toString("latin1");
    for (const [, key] of FEATURE_PACK_SECTIONS) {
      expect(text).toContain(key + "-fixture");
      expect(pdf).toContain(key + "-fixture");
    }
    expect(text).toContain("No causal proof");
    expect(pdf).toContain("Human review required");
    expect(pdf).toContain("DRAFT");
    expect(text).toContain("hypothetical");
    expect(text).toContain("no amounts are added");
  });
  it("refuses oversized exports explicitly without silently dropping records", () => {
    expect(() =>
      buildEvidencePackPdf({
        pack_payload: {
          integratedFeaturesVersion: "1",
          geospatialFindings: [{ id: "long", notes: "x".repeat(2_000_001) }],
        },
      }),
    ).toThrow("PDF_EXPORT_LIMIT");
  });
  it("refuses page overflow even when short multiline records fit input budget", () => {
    expect(() =>
      buildEvidencePackPdf({
        pack_payload: {
          integratedFeaturesVersion: "1",
          geospatialFindings: Array.from({ length: 180 }, (_, i) => ({
            id: "synthetic-" + i,
            notes: "line\n".repeat(100),
          })),
        },
      }),
    ).toThrow("200-page");
  });
  it("exports database-derived case baseline and honest impact gap rather than writable metric markers", () => {
    const p = {
      integratedFeaturesVersion: "1",
      simulationCaseComparison: {
        caseId: "synthetic-case",
        recordedLinkedEvents: 2,
        linkedEventIds: ["linked-one", "linked-two"],
        scenarioImpact: "insufficient_data",
        limitation: "No approved assumptions",
      },
    };
    expect(featurePackSummary(p)).toContain("database-derived-case-comparison");
    const pdf = Buffer.from(buildEvidencePackPdf({ pack_payload: p })).toString("latin1");
    expect(pdf).toContain("linked-one");
    expect(pdf).toContain("insufficient_data");
    expect(pdf).toContain("No approved assumptions");
  });
  it("keeps original core evidence registers in the sealed summary", () => {
    const text = frozenPackSummary({
      case: { reference_no: "SYNTHETIC" },
      claims: [{ id: "claim-core", claim_text: "SOURCE CORE" }],
      timeline: [{ id: "timeline-core" }],
      financialCalculations: [{ id: "finance-core" }],
      integratedFeaturesVersion: "1",
    });
    for (const marker of [
      "SYNTHETIC",
      "SOURCE CORE",
      "claim-core",
      "timeline-core",
      "finance-core",
    ])
      expect(text).toContain(marker);
  });
  it("never augments an old pack with live records or interprets absent schema as empty", () => {
    expect(featurePackSummary({})).toContain("not frozen");
    expect(
      Buffer.from(buildEvidencePackPdf({ version: 1, status: "DRAFT", pack_payload: {} })).toString(
        "latin1",
      ),
    ).toContain("historical pack");
  });
  it("shows all empty registers explicitly without inventing resolution or money", () => {
    const sections = featurePackSections({ integratedFeaturesVersion: "1" });
    expect(sections).toHaveLength(13);
    expect(sections.every((s) => s.rows.length === 0)).toBe(true);
    expect(featurePackSummary({ integratedFeaturesVersion: "1" })).toContain(
      "No eligible case-linked records",
    );
  });
});
