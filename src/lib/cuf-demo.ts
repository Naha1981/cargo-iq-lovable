// Fictional demonstration records only. No customer data or persistence.
export const SYNTHETIC_NOTICE = "SYNTHETIC DEMO ONLY - not CUF/member/Brenda records";
export const demoRecords = [
  {
    "synthetic_notice": "SYNTHETIC DEMO ONLY - not CUF/member/Brenda records",
    "record_id": "M01",
    "source_party": "Terminal record",
    "claim_type": "hatch_cover_operation",
    "timestamp_utc": "2026-10-14T04:00:00Z",
    "event_reference": "HATCH-SYN-01",
    "quantity": "4",
    "counting_basis": "individual lifts",
    "statement": "Terminal counts four lifts for the hatch-cover operation; not four container moves."
  },
  {
    "synthetic_notice": "SYNTHETIC DEMO ONLY - not CUF/member/Brenda records",
    "record_id": "M02",
    "source_party": "Carrier record",
    "claim_type": "hatch_cover_operation",
    "timestamp_utc": "2026-10-14T04:00:00Z",
    "event_reference": "HATCH-SYN-01",
    "quantity": "1",
    "counting_basis": "hatch-cover operation",
    "statement": "Carrier groups the same four lifts as one operation; units differ, so do not subtract raw counts."
  },
  {
    "synthetic_notice": "SYNTHETIC DEMO ONLY - not CUF/member/Brenda records",
    "record_id": "T01",
    "source_party": "SA terminal record",
    "claim_type": "truck_visit",
    "timestamp_utc": "2026-10-14T18:00:00Z",
    "event_reference": "TRUCK-SYN-01",
    "quantity": "1",
    "counting_basis": "truck visit",
    "statement": "One vehicle visit carrying two synthetic containers SYN-C01 and SYN-C02."
  },
  {
    "synthetic_notice": "SYNTHETIC DEMO ONLY - not CUF/member/Brenda records",
    "record_id": "T02",
    "source_party": "Other party record",
    "claim_type": "container_delivery",
    "timestamp_utc": "2026-10-14T18:00:00Z",
    "event_reference": "TRUCK-SYN-01",
    "quantity": "2",
    "counting_basis": "container deliveries",
    "statement": "Same truck visit, two boxes. This is a counting-basis difference, not proof of an extra truck."
  },
  {
    "synthetic_notice": "SYNTHETIC DEMO ONLY - not CUF/member/Brenda records",
    "record_id": "Q01",
    "source_party": "Transporter queue log",
    "claim_type": "outside_queue_arrival",
    "timestamp_utc": "2026-10-14T06:00:00Z",
    "event_reference": "TRUCK-SYN-01",
    "quantity": "",
    "counting_basis": "timestamp",
    "statement": "Outside queue arrival, not terminal gate-in."
  },
  {
    "synthetic_notice": "SYNTHETIC DEMO ONLY - not CUF/member/Brenda records",
    "record_id": "Q02",
    "source_party": "Terminal gate log",
    "claim_type": "terminal_gate_in",
    "timestamp_utc": "2026-10-14T18:00:00Z",
    "event_reference": "TRUCK-SYN-01",
    "quantity": "",
    "counting_basis": "timestamp",
    "statement": "Gate-in. Outside queue interval is twelve hours from Q01."
  },
  {
    "synthetic_notice": "SYNTHETIC DEMO ONLY - not CUF/member/Brenda records",
    "record_id": "Q03",
    "source_party": "Terminal gate log",
    "claim_type": "terminal_gate_out",
    "timestamp_utc": "2026-10-14T20:00:00Z",
    "event_reference": "TRUCK-SYN-01",
    "quantity": "",
    "counting_basis": "timestamp",
    "statement": "Gate-out. Inside-terminal interval is two hours from Q02."
  },
  {
    "synthetic_notice": "SYNTHETIC DEMO ONLY - not CUF/member/Brenda records",
    "record_id": "A01",
    "source_party": "Shipping line appointment notice",
    "claim_type": "appointment_issued",
    "timestamp_utc": "2026-10-13T10:00:00Z",
    "event_reference": "APPT-SYN-01",
    "quantity": "",
    "counting_basis": "appointment",
    "statement": "Issued by Synthetic Shipping Line. Slot: 14 October 18:00Z. Issuer is not the terminal."
  },
  {
    "synthetic_notice": "SYNTHETIC DEMO ONLY - not CUF/member/Brenda records",
    "record_id": "A02",
    "source_party": "Transporter claim",
    "claim_type": "claim_target",
    "timestamp_utc": "2026-10-15T07:00:00Z",
    "event_reference": "APPT-SYN-01",
    "quantity": "",
    "counting_basis": "party assertion",
    "statement": "Transporter claim targets Synthetic Terminal. Check issuer, terms, obligations and evidence; no liability conclusion."
  },
  {
    "synthetic_notice": "SYNTHETIC DEMO ONLY - not CUF/member/Brenda records",
    "record_id": "K01",
    "source_party": "Carrier KPI definition",
    "claim_type": "carrier_vessel_window_start",
    "timestamp_utc": "2026-10-14T00:00:00Z",
    "event_reference": "VESSEL-SYN-01",
    "quantity": "",
    "counting_basis": "clock start",
    "statement": "Carrier clock starts at vessel-window opening. End 14 October 20:00Z. Twenty-hour interval."
  },
  {
    "synthetic_notice": "SYNTHETIC DEMO ONLY - not CUF/member/Brenda records",
    "record_id": "K02",
    "source_party": "Terminal KPI definition",
    "claim_type": "first_box_off",
    "timestamp_utc": "2026-10-14T04:00:00Z",
    "event_reference": "VESSEL-SYN-01",
    "quantity": "",
    "counting_basis": "clock start",
    "statement": "Terminal operational clock starts at first box off. Different event from vessel-window opening."
  },
  {
    "synthetic_notice": "SYNTHETIC DEMO ONLY - not CUF/member/Brenda records",
    "record_id": "K03",
    "source_party": "Terminal KPI definition",
    "claim_type": "last_box_on",
    "timestamp_utc": "2026-10-14T20:00:00Z",
    "event_reference": "VESSEL-SYN-01",
    "quantity": "",
    "counting_basis": "clock end",
    "statement": "First-box-off to last-box-on is sixteen hours. Compare definitions before KPIs; do not call different starts a factual contradiction."
  },
  {
    "synthetic_notice": "SYNTHETIC DEMO ONLY - not CUF/member/Brenda records",
    "record_id": "C01",
    "source_party": "Terminal gate log export A",
    "claim_type": "terminal_gate_in",
    "timestamp_utc": "2026-10-14T18:00:00Z",
    "event_reference": "TRUCK-SYN-01",
    "quantity": "",
    "counting_basis": "conflicting timestamp",
    "statement": "Same gate-in event as C02, export A says 18:00Z. Unresolved."
  },
  {
    "synthetic_notice": "SYNTHETIC DEMO ONLY - not CUF/member/Brenda records",
    "record_id": "C02",
    "source_party": "Terminal gate log export B",
    "claim_type": "terminal_gate_in",
    "timestamp_utc": "2026-10-14T19:00:00Z",
    "event_reference": "TRUCK-SYN-01",
    "quantity": "",
    "counting_basis": "conflicting timestamp",
    "statement": "Same gate-in event as C01, export B says 19:00Z. Unresolved; twelve-hour queue/two-hour inside split is provisional pending reconciliation."
  },
  {
    "synthetic_notice": "SYNTHETIC DEMO ONLY - not CUF/member/Brenda records",
    "record_id": "G01",
    "source_party": "Dataset manifest",
    "claim_type": "missing_processing_events",
    "timestamp_utc": "",
    "event_reference": "VESSEL-SYN-01",
    "quantity": "",
    "counting_basis": "known data gap",
    "statement": "No terminal processing steps between first box off and last box on supplied. Do not invent processing detail or infer responsibility."
  }
] as const;
export type DemoRecord = (typeof demoRecords)[number];
export function findTimestampConflicts(records: readonly DemoRecord[]) {
  const conflicts: { event: string; claimType: string; records: string[] }[] = [];
  const groups = new Map<string, DemoRecord[]>();
  for (const record of records) {
    if (!record.timestamp_utc) continue;
    const key = `${record.event_reference}:${record.claim_type}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  for (const [key, group] of groups) {
    const times = group.map(r => Date.parse(r.timestamp_utc));
    if (Math.max(...times) - Math.min(...times) >= 3_600_000) {
      conflicts.push({ event: key, claimType: group[0].claim_type, records: group.map(r => r.record_id) });
    }
  }
  return conflicts;
}
export function gateDurations(gateIn: string) {
  const queue = demoRecords.find(r => r.record_id === "Q01")!;
  const out = demoRecords.find(r => r.record_id === "Q03")!;
  const start = Date.parse(gateIn);
  if (!Number.isFinite(start)) throw new Error("A supported gate-in time is required");
  return { outside: (start - Date.parse(queue.timestamp_utc)) / 3_600_000,
    inside: (Date.parse(out.timestamp_utc) - start) / 3_600_000 };
}
