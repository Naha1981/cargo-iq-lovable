import { demoRecords } from "./cuf-demo";
import type { getCaseWorkspace } from "./case.functions";
const caseId = "00000000-0000-4000-8000-000000000001";
export const publicSampleWorkspace = {
  tenantId: "PUBLIC-FICTIONAL",
  clockBlocked: true,
  case: {
    id: caseId,
    tenant_id: "PUBLIC-FICTIONAL",
    reference_no: "SYN-COUNT-CLOCK-01",
    title: "Fictional counting and clock sample",
    vessel_name: "Fictional sample vessel",
    port_code: "DUR",
    container_no: "SYN-C01 + SYN-C02",
    counterparty: "Synthetic Terminal",
    created_at: "2026-10-14T00:00:00Z",
    created_by: null,
    dd_evidence_draft: null,
    dd_evidence_draft_revision: 0,
    dispute_type: "clock_review",
    status: "INVESTIGATING",
    voyage_no: null,
  },
  documents: [],
  claims: [],
  contradictions: [],
  observations: [],
  calculations: [],
  packs: [],
  timeline: demoRecords
    .filter((r) => r.timestamp_utc)
    .map((r) => ({
      id: r.record_id,
      case_id: caseId,
      tenant_id: "PUBLIC-FICTIONAL",
      coordinates: null,
      created_at: r.timestamp_utc,
      evidence_class: "FICTIONAL_SAMPLE",
      nature: "reported",
      provenance_id: null,
      source: r.source_party,
      timestamp: r.timestamp_utc,
      title: r.record_id + " - " + r.statement,
    })),
} satisfies Awaited<ReturnType<typeof getCaseWorkspace>>;
