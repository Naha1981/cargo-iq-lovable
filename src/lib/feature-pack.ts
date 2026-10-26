/** Frozen review sections only. No live queries, causal promotion or recovery totals. */
export const FEATURE_PACK_SECTIONS = [
  [
    "Risk events and corridor context",
    "riskEvents",
    "Candidate associations and reference coordinates do not prove shipment exposure or causation.",
  ],
  [
    "Case-event association rationale",
    "riskEventCaseLinks",
    "Port, corridor and vessel-name matching is a candidate association only.",
  ],
  [
    "Risk alerts and recommended actions",
    "riskAlerts",
    "Severity and status are not evidence verification or a liability decision.",
  ],
  [
    "Human risk verification history",
    "riskAlertReviews",
    "Review decisions retain their actor, time and notes.",
  ],
  [
    "Cost recovery review",
    "costRecoveryLinks",
    "Potential, recoverable and recovered are distinct; no amounts are added across registers or currencies.",
  ],
  [
    "Geospatial findings and manual imagery review",
    "geospatialFindings",
    "Overview pixels and manual regions are unverified review material, not automated change detection, causation or aligned analysis-grade imagery.",
  ],
  [
    "Geospatial review audit",
    "geospatialFindingEvents",
    "Only history whose before and after records match this case is included. Earlier moved-case history is withheld, not proof that no earlier review occurred.",
  ],
  [
    "Scene assets and provenance",
    "sceneAssets",
    "Asset registration or a tileset URL does not prove conversion, successful rendering or geographic alignment.",
  ],
  [
    "Scene asset audit",
    "sceneAssetEvents",
    "Conversion unavailability stays an explicit gap. Only case-matching before/after history is included; moved-case history is withheld.",
  ],
  [
    "Revenue recovery findings",
    "recoveryFindings",
    "Comparison inputs are operator assertions unless supported by cited documents; entitlement is unverified. Recovered requires confirmed receipt.",
  ],
  [
    "Revenue recovery audit",
    "recoveryFindingEvents",
    "No external submission or payment is performed by this pack. Only case-matching before/after history is included; moved-case history is withheld.",
  ],
  [
    "Case-linked hypothetical scenarios and decisions",
    "simulationScenarios",
    "Explicit case link only. Scenario name, assumptions and decision text are case-linked human assertions, not validated facts. Stored comparison metrics and machine arrays are withheld because writable scope markers do not prove case provenance. No forecast or claim amount is asserted.",
  ],
  [
    "Scenario comparison and decision audit",
    "simulationScenarioEvents",
    "Only case-matching history is included. Older tenant-wide comparison results or other-case history are withheld; assumptions are not facts.",
  ],
] as const;
export function featurePackSections(payload: Record<string, unknown>) {
  return FEATURE_PACK_SECTIONS.map(([title, key, caveat]) => ({
    title,
    key,
    caveat,
    rows: [
      ...(Array.isArray(payload[key]) ? (payload[key] as Record<string, unknown>[]) : []),
      ...(key === "simulationScenarios" &&
      payload.simulationCaseComparison &&
      typeof payload.simulationCaseComparison === "object"
        ? [
            {
              id: "database-derived-case-comparison",
              ...(payload.simulationCaseComparison as Record<string, unknown>),
            },
          ]
        : []),
    ],
  }));
}
export function featurePackSummary(payload: Record<string, unknown>): string {
  if (payload.integratedFeaturesVersion !== "1")
    return "Integrated feature registers were not frozen in this historical pack. Do not infer their absence from today's case.";
  return featurePackSections(payload)
    .map(
      (s) =>
        s.title +
        " (" +
        s.rows.length +
        ")\n" +
        s.caveat +
        "\n" +
        (s.rows.length
          ? s.rows.map((r) => JSON.stringify(r)).join("\n")
          : "No eligible case-linked records in this frozen version; excluded or withheld history may exist."),
    )
    .join("\n\n");
}

/** Human-readable summary comes only from sealed data, including original core registers. */
export function frozenPackSummary(payload: Record<string, unknown>): string {
  const featureKeys = new Set<string>(FEATURE_PACK_SECTIONS.map(([, key]) => key));
  const core = Object.entries(payload).filter(
    ([key]) =>
      !featureKeys.has(key) &&
      !["integratedFeaturesVersion", "simulationCaseComparison"].includes(key),
  );
  return (
    core
      .map(
        ([key, value]) =>
          key +
          "\n" +
          (Array.isArray(value)
            ? value.length
              ? value.map((row) => JSON.stringify(row)).join("\n")
              : "No records in this frozen version."
            : JSON.stringify(value)),
      )
      .join("\n\n") +
    "\n\n" +
    featurePackSummary(payload)
  );
}
