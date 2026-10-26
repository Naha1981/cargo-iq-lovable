import { INTEGRATED_FEATURE_UNAVAILABLE } from "@/lib/integrated-feature-gate";

export function IntegratedFeatureUnavailable({ title }: { title: string }) {
  return (
    <section className="rounded-lg border p-5" role="status">
      <h2 className="mb-2 text-base font-semibold">{title} - not activated</h2>
      <p className="max-w-2xl text-sm text-muted-foreground">{INTEGRATED_FEATURE_UNAVAILABLE}</p>
      <p className="mt-3 text-xs text-muted-foreground">
        Source implementation is preserved. Activation, authenticated save/reload acceptance and any
        production database changes are separate release steps.
      </p>
    </section>
  );
}
