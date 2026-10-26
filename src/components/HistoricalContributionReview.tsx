import { HISTORICAL_REVIEW_LIMITS } from "@/lib/historical-review";
export interface HistoricalSelection {
  requestId: string;
  date: string;
  place: string;
  lat: number;
  lon: number;
}
export function HistoricalContributionReview({
  proposal,
  saving,
  onConfirm,
  onCancel,
}: {
  proposal: HistoricalSelection;
  saving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="space-y-2 rounded border p-4" aria-label="Confirm historical contribution">
      <h2 className="font-semibold">Confirm historical record review</h2>
      <p>
        {proposal.place} | {proposal.date} (Africa/Johannesburg), within 2 km of {proposal.lat},{" "}
        {proposal.lon}.
      </p>
      <p className="text-sm text-muted-foreground">{HISTORICAL_REVIEW_LIMITS}</p>
      <p className="text-sm">
        The server will save the current matching case records and your review time. This does not
        approve the pack or resolve the case.
      </p>
      <button disabled={saving} className="rounded border px-3 py-2" onClick={onConfirm}>
        {saving ? "Saving..." : "Confirm and save to case"}
      </button>
      <button disabled={saving} className="ml-3 rounded border px-3 py-2" onClick={onCancel}>
        Cancel
      </button>
    </section>
  );
}
