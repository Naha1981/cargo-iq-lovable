import { z } from "zod";
export const clockKinds = [
  "QUEUE_ARRIVAL",
  "APPOINTMENT_START",
  "APPOINTMENT_END",
  "GATE_IN",
  "GATE_OUT",
  "VESSEL_WINDOW_START",
  "FIRST_BOX_OFF",
  "LAST_BOX_ON",
] as const;
const zoned = z
  .string()
  .datetime({ offset: true })
  .refine((v) => /([+-]\d\d:\d\d|Z)$/.test(v), "Include UTC Z or an explicit offset");
export const clockInput = z
  .object({
    caseId: z.string().uuid(),
    physicalReference: z.string().trim().min(3).max(200),
    kind: z.enum(clockKinds),
    timestamp: zoned,
    timeZone: z
      .string()
      .min(1)
      .max(100)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, "Use an IANA timezone"),
    sourceParty: z.string().trim().min(2).max(200),
    sourceDocumentId: z.string().uuid(),
    sourceReference: z.string().trim().min(3).max(1000),
    locationBasis: z.string().trim().min(3).max(1000),
    appointmentIssuer: z.string().trim().max(200),
    appointmentReference: z.string().trim().max(200),
    appointmentParties: z.string().trim().max(2000),
    appointmentTerms: z.string().trim().max(4000),
  })
  .superRefine((x, c) => {
    if (
      x.kind.startsWith("APPOINTMENT_") &&
      (!x.appointmentIssuer ||
        !x.appointmentReference ||
        !x.appointmentParties ||
        !x.appointmentTerms)
    )
      c.addIssue({
        code: "custom",
        path: ["appointmentIssuer"],
        message:
          "Appointment clocks require issuer, appointment reference, parties and source-backed terms (state unknown explicitly when not evidenced)",
      });
  });
export interface ClockRecord {
  id: string;
  kind: string;
  physical_reference: string;
  timestamp_original: string;
  time_zone?: string | null;
  source_party?: string | null;
  source_document_id?: string | null;
  source_reference?: string | null;
  location_basis?: string | null;
  appointment_issuer?: string | null;
  appointment_reference?: string | null;
  appointment_parties?: string | null;
  appointment_terms?: string | null;
}
export interface ClockDecision {
  id?: string;
  physical_reference: string;
  kind: string;
  version: number;
  selected_clock_id?: string | null;
  considered_clock_ids?: string[] | null;
}
export function reconciledClockGroup(records: ClockRecord[], decisions: ClockDecision[] = []) {
  if (!records.length) return { times: [] as number[], decision: null as ClockDecision | null };
  const allTimes = [...new Set(records.map((r) => Date.parse(r.timestamp_original)))];
  const latest = decisions
    .filter(
      (d) => d.physical_reference === records[0].physical_reference && d.kind === records[0].kind,
    )
    .sort((a, b) => b.version - a.version)[0];
  const ids = records.map((r) => r.id).sort(),
    snapshot = latest?.considered_clock_ids?.slice().sort();
  const selected = latest && records.find((r) => r.id === latest.selected_clock_id);
  if (selected && JSON.stringify(ids) === JSON.stringify(snapshot))
    return { times: [Date.parse(selected.timestamp_original)], decision: latest };
  return { times: allTimes, decision: null };
}
export function compareClocks(rows: ClockRecord[], decisions: ClockDecision[] = []) {
  const references = [...new Set(rows.map((r) => r.physical_reference))];
  return references.map((ref) => {
    const records = rows.filter((r) => r.physical_reference === ref);
    const get = (kind: string) => {
      const matches = records.filter((r) => r.kind === kind);
      const { times, decision } = reconciledClockGroup(matches, decisions);
      return { matches, times, decision };
    };
    const definitions = [
      {
        label: "Outside queue: precinct/geofence arrival to terminal gate-in",
        start: "QUEUE_ARRIVAL",
        end: "GATE_IN",
      },
      { label: "Inside terminal: gate-in to gate-out", start: "GATE_IN", end: "GATE_OUT" },
      {
        label: "Appointment clock: slot start to gate-in (negative means early)",
        start: "APPOINTMENT_START",
        end: "GATE_IN",
      },
      {
        label: "Appointment window: slot start to slot end",
        start: "APPOINTMENT_START",
        end: "APPOINTMENT_END",
      },
    ];
    return {
      reference: ref,
      records,
      results: definitions.map((d) => {
        const a = get(d.start),
          b = get(d.end);
        const missing = !a.times.length || !b.times.length;
        const conflicting = a.times.length > 1 || b.times.length > 1;
        const hours = !missing && !conflicting ? (b.times[0] - a.times[0]) / 3_600_000 : null;
        const invalid =
          hours !== null &&
          hours < 0 &&
          d.label !== "Appointment clock: slot start to gate-in (negative means early)";
        return {
          ...d,
          status: missing
            ? "MISSING"
            : conflicting
              ? "CONFLICTING"
              : invalid
                ? "INVALID_ORDER"
                : "DERIVED",
          hours: invalid ? null : hours,
          reconciliationIds: [a.decision?.id, b.decision?.id].filter(Boolean),
          sources: [...a.matches, ...b.matches].map((r) => ({
            id: r.id,
            document: r.source_document_id,
            reference: r.source_reference,
            party: r.source_party,
            timestamp: r.timestamp_original,
            timeZone: r.time_zone,
          })),
        };
      }),
    };
  });
}
