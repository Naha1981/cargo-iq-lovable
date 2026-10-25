import type { Rate } from "./quote-engine";
export function rateFromRow(r: any): Rate {
  return {
    id: r.id,
    batchId: r.batch_id,
    version: r.version,
    origin: r.origin,
    destination: r.destination,
    equipment: r.equipment,
    minKg: r.min_kg,
    maxKg: r.max_kg,
    amountMinor: Number(r.amount_minor),
    currency: r.currency,
    vatTreatment: r.vat_treatment,
    vatBps: r.vat_bps,
    validFrom: new Date(r.valid_from).toISOString(),
    validTo: new Date(r.valid_to).toISOString(),
    validityHours: r.validity_hours,
    terms: r.terms,
    exclusions: r.exclusions,
    sourceReference: r.source_reference,
    disclosureApproved: r.disclosure_approved,
  };
}
