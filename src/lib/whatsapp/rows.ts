import type { Rate } from "./quote-engine";
import type { WaQuoteRateRow } from "@/integrations/supabase/types";

export function rateFromRow(r: WaQuoteRateRow): Rate {
  return {
    id: r.id,
    batchId: r.batch_id,
    version: r.version,
    origin: r.origin as Rate["origin"],
    destination: r.destination as Rate["destination"],
    equipment: r.equipment as Rate["equipment"],
    minKg: r.min_kg,
    maxKg: r.max_kg,
    amountMinor: Number(r.amount_minor),
    currency: r.currency as Rate["currency"],
    vatTreatment: r.vat_treatment as Rate["vatTreatment"],
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
